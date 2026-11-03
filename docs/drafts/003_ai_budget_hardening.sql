-- docs/drafts/003_ai_budget_hardening.sql — REVIEW ONLY, DO NOT APPLY DIRECTLY
-- Owner approval required. This candidate replaces the unsafe proposal in docs/AI-BUDGET-PROPOSAL.md.
-- Existing live migrations 001_initial.sql and 002_ai.sql remain applied; this file is read by tests via PGlite.
-- Core idea: integer micro-USD per-provider budget with protected reserve, atomic worst-case reservation
-- from server-held bounded pricebook (missing price rejects), operation identity separates request from attempts,
-- duplicate returns cached/pending never permits provider anew, provider+price snapshotted, no user refund RPC.
-- Fail/timeout counts full max (no refunds in v1). Default disabled, zero spend until credit->USD + reserve approved.
-- 150 META credits exclusively app; 100 Baseten coding separate; exact conversion unknown.

-- Budget hardening: per-provider micro-USD caps with protected reserve
alter table public.ai_budget add column if not exists meta_micro_usd_cap bigint check (meta_micro_usd_cap is null or meta_micro_usd_cap between 0 and 100000000000);
alter table public.ai_budget add column if not exists meta_micro_usd_used bigint not null default 0 check (meta_micro_usd_used >= 0);
alter table public.ai_budget add column if not exists baseten_micro_usd_cap bigint check (baseten_micro_usd_cap is null or baseten_micro_usd_cap between 0 and 100000000000);
alter table public.ai_budget add column if not exists baseten_micro_usd_used bigint not null default 0 check (baseten_micro_usd_used >= 0);
alter table public.ai_budget add column if not exists reserve_micro_usd bigint not null default 0 check (reserve_micro_usd >= 0 and reserve_micro_usd <= 100000000000);
alter table public.ai_budget add column if not exists reserve_reason text check (char_length(reserve_reason) <= 200);

-- Server-held bounded price table: client cannot forge costs; missing price => reject
create table if not exists public.ai_pricebook (
  feature text primary key check (feature in ('draft','transcribe','cutout','moderation')),
  provider text not null check (provider in ('baseten','meta')),
  max_cost_micro_usd integer not null check (max_cost_micro_usd > 0 and max_cost_micro_usd <= 1000000),
  enabled boolean not null default false
);
insert into public.ai_pricebook(feature, provider, max_cost_micro_usd, enabled) values
  ('draft','meta', 1500, false),
  ('transcribe','meta', 500, false),
  ('cutout','meta', 3000, false),
  ('moderation','baseten', 1000, false)
on conflict (feature) do nothing;
comment on table public.ai_pricebook is 'Server-held pricebook; unknown price rejects; client cannot set cost';

-- Operation identity: request vs attempts; idempotency per user+feature+key
create table if not exists public.ai_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null references public.ai_pricebook(feature),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  listing_id uuid references public.listings(id) on delete set null,
  provider text not null check (provider in ('baseten','meta')),
  price_micro_usd integer not null check (price_micro_usd > 0),
  status text not null check (status in ('pending','done','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_ops_user_feature_key_unique unique (user_id, feature, idempotency_key)
);
create index if not exists ai_ops_user_created_idx on public.ai_operations(user_id, created_at);

-- Attempts: each provider try snapshots provider+price; fail/timeout counts full max, no refund RPC
create table if not exists public.ai_attempts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.ai_operations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null,
  provider text not null,
  price_micro_usd integer not null,
  ok boolean,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms between 0 and 60000)
);
create index if not exists ai_attempts_op_idx on public.ai_attempts(operation_id);
create index if not exists ai_attempts_user_feature_idx on public.ai_attempts(user_id, feature, created_at);

-- Extend usage snapshot (retrofit existing) for audit: provider + price at reservation time
alter table public.ai_usage add column if not exists provider text check (provider is null or provider in ('baseten','meta'));
alter table public.ai_usage add column if not exists price_micro_usd integer check (price_micro_usd is null or price_micro_usd > 0);
alter table public.ai_usage add column if not exists operation_id uuid references public.ai_operations(id) on delete set null;

-- RLS: all candidate tables default deny; only service-role-implied definer functions access
alter table public.ai_pricebook enable row level security;
alter table public.ai_operations enable row level security;
alter table public.ai_attempts enable row level security;
revoke all on public.ai_pricebook, public.ai_operations, public.ai_attempts from anon, authenticated;
-- pricebook readable for audit via select policy, but not writable
create policy ai_pricebook_read on public.ai_pricebook for select to authenticated using (true);
grant select on public.ai_pricebook to authenticated;
-- operations/attempts: owner can read own, but never direct write; writes via RPC only
create policy own_ai_ops on public.ai_operations for select to authenticated using (user_id = auth.uid());
create policy own_ai_attempts on public.ai_attempts for select to authenticated using (user_id = auth.uid());
grant select on public.ai_operations to authenticated;
grant select on public.ai_attempts to authenticated;

-- Retire old signatures: remove public exec on 3-arg reserve/complete to prevent bypass
revoke all on function public.reserve_ai_usage(text,integer,integer) from public, anon, authenticated;
revoke all on function public.complete_ai_usage(uuid,boolean,integer) from public, anon, authenticated;

-- Trusted entrypoint: reserves worst-case price atomically, enforces idempotency, snapshots budget
create or replace function public.reserve_ai_attempt(
  p_feature text,
  p_idempotency_key text,
  p_listing_id uuid default null
) returns table(operation_id uuid, attempt_id uuid, allowed boolean, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  pb public.ai_pricebook;
  bud public.ai_budget;
  existing_op public.ai_operations;
  new_op_id uuid;
  new_attempt uuid;
  today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  global_count integer;
  user_count integer;
begin
  if who is null then return query select null::uuid,null::uuid,false,'unauthorized'::text; return; end if;
  if p_feature is null or p_idempotency_key is null or char_length(p_idempotency_key) < 8 then
    return query select null::uuid,null::uuid,false,'invalid_args'::text; return; end if;
  if p_listing_id is not null then
    if not exists (select 1 from public.listings where id = p_listing_id and seller_id = who) then
      return query select null::uuid,null::uuid,false,'listing_forbidden'::text; return; end if;
  end if;

  select * into pb from public.ai_pricebook where feature = p_feature;
  if not found or pb.enabled is distinct from true or pb.max_cost_micro_usd is null then
    return query select null::uuid,null::uuid,false,'unpriced_feature'::text; return; end if;

  -- check existing operation first (no new charge); still need lock for budget?
  select * into existing_op from public.ai_operations where user_id = who and feature = p_feature and idempotency_key = p_idempotency_key;
  if found then
    if existing_op.status = 'done' then
      return query select existing_op.id, null::uuid, true, 'duplicate_done'::text; return;
    elsif existing_op.status = 'pending' then
      return query select existing_op.id, null::uuid, true, 'duplicate_pending'::text; return;
    else
      -- prior failed: allow new attempt but keep same operation identity? create new attempt linked
      -- we still reserve budget atomically below
      null;
    end if;
  end if;

  select * into bud from public.ai_budget where id = true for update;
  if bud.enabled is distinct from true then return query select null::uuid,null::uuid,false,'disabled'::text; return; end if;

  -- per-day counts include attempts (even pending/failed) — counts in-flight as billed
  select count(*) into global_count from public.ai_attempts where created_at >= today;
  select count(*) into user_count from public.ai_attempts where user_id = who and created_at >= today;
  if global_count >= bud.daily_limit then return query select null::uuid,null::uuid,false,'global_limit'::text; return; end if;
  if user_count >= bud.per_user_limit then return query select null::uuid,null::uuid,false,'user_limit'::text; return; end if;

  -- per-provider micro-USD budget with protected reserve (normal traffic limited to cap - reserve)
  if pb.provider = 'meta' and bud.meta_micro_usd_cap is not null then
    if bud.meta_micro_usd_used + pb.max_cost_micro_usd > (bud.meta_micro_usd_cap - bud.reserve_micro_usd) then
      return query select null::uuid,null::uuid,false,'budget_exhausted'::text; return; end if;
  elsif pb.provider = 'baseten' and bud.baseten_micro_usd_cap is not null then
    if bud.baseten_micro_usd_used + pb.max_cost_micro_usd > (bud.baseten_micro_usd_cap - bud.reserve_micro_usd) then
      return query select null::uuid,null::uuid,false,'budget_exhausted'::text; return; end if;
  end if;

  -- upsert operation (idempotent key); if race, unique violation will be caught by caller retry as duplicate
  if existing_op.id is null then
    insert into public.ai_operations(user_id, feature, idempotency_key, listing_id, provider, price_micro_usd, status)
    values (who, p_feature, p_idempotency_key, p_listing_id, pb.provider, pb.max_cost_micro_usd, 'pending')
    returning id into new_op_id;
  else
    new_op_id := existing_op.id;
    update public.ai_operations set listing_id = coalesce(p_listing_id, listing_id), updated_at = now() where id = new_op_id;
  end if;

  insert into public.ai_attempts(operation_id, user_id, feature, provider, price_micro_usd)
  values (new_op_id, who, p_feature, pb.provider, pb.max_cost_micro_usd) returning id into new_attempt;

  insert into public.ai_usage(user_id, feature, provider, price_micro_usd, operation_id)
  values (who, p_feature, pb.provider, pb.max_cost_micro_usd, new_op_id);

  if pb.provider = 'meta' then
    update public.ai_budget set meta_micro_usd_used = meta_micro_usd_used + pb.max_cost_micro_usd where id = true;
  else
    update public.ai_budget set baseten_micro_usd_used = baseten_micro_usd_used + pb.max_cost_micro_usd where id = true;
  end if;

  return query select new_op_id, new_attempt, true, null::text;
end; $$;
revoke all on function public.reserve_ai_attempt(text,text,uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_attempt(text,text,uuid) to authenticated;

-- completion: marks attempt+operation; no refund, fail counts full max
create or replace function public.complete_ai_attempt(p_attempt_id uuid, p_ok boolean, p_ms integer, p_result jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare who uuid := auth.uid(); att public.ai_attempts;
begin
  if who is null then raise exception 'auth required'; end if;
  if p_ms < 0 or p_ms > 60000 or p_ok is null then raise exception 'invalid completion'; end if;
  select * into att from public.ai_attempts where id = p_attempt_id and user_id = who for update;
  if not found then raise exception 'attempt not found'; end if;
  if att.completed_at is not null then return; end if;
  update public.ai_attempts set ok = p_ok, completed_at = now(), duration_ms = p_ms where id = p_attempt_id;
  update public.ai_operations set status = case when p_ok then 'done' else 'failed' end, result = p_result, updated_at = now()
    where id = att.operation_id and user_id = who;
  update public.ai_usage set completed_at = now(), ok = p_ok, duration_ms = p_ms where operation_id = att.operation_id and completed_at is null;
end; $$;
revoke all on function public.complete_ai_attempt(uuid,boolean,integer,jsonb) from public, anon, authenticated;
grant execute on function public.complete_ai_attempt(uuid,boolean,integer,jsonb) to authenticated;

-- ensure old functions remain revoked (no bypass via old 3-arg)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'reserve_ai_usage') then
    revoke all on function public.reserve_ai_usage(text,integer,integer) from public, anon, authenticated;
  end if;
end $$;

-- Default state: disabled, zero spend, caps null (meaning no budget until configured)
-- Pricebook disabled until owner approves credit->USD conversion and reserve
update public.ai_budget set enabled = false, reserve_micro_usd = 0 where id = true;
update public.ai_pricebook set enabled = false;

-- Least-privilege notes:
-- Normal app CRUD (listings/threads/messages/profiles) uses anon/authenticated via RLS + column grants; no service_role.
-- Budget enforcement is via SECURITY DEFINER functions with FOR UPDATE on ai_budget; only these functions can bump micro_usd_used.
-- No service_role key is needed in normal app env; management of ai_budget/ai_pricebook requires out-of-band owner role.
-- Client cannot forge costs (price from ai_pricebook), cannot free duplicate (duplicate returns existing operation without provider call), cannot refund (no refund RPC).

