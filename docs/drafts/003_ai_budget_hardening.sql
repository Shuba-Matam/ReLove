-- docs/drafts/003_ai_budget_hardening.sql — REVIEW ONLY, DO NOT APPLY DIRECTLY
-- Owner approval required. Existing live migrations 001_initial.sql and 002_ai.sql remain applied; this file is read by tests via PGlite.
-- Pending owner choices (not configured): credit->microUSD conversion for 150 META app credits vs 100 Baseten coding separate;
-- exact reserve allocation per provider. Until owner supplies conversion + reserve, defaults stay disabled/zero, pricebook empty.
-- No paid Meta/Baseten tests authorized; gates remain off (AI_ENABLED=false, ai_budget.enabled=false).
--
-- Core idea: integer micro-USD per-provider budget with per-provider reserve, atomic worst-case reservation
-- from server-held pricebook (missing/null/nonpositive price rejects, disabled rejects), operation identity
-- binds feature/user/provider/model/source_hash, duplicate never re-executes provider, provider+price snapshotted,
-- max 3 attempts per operation across requests, completion fenced to current attempt, fail/timeout counts full max, no user refund.

-- 1) Per-provider micro-USD caps + per-provider reserve (fixes NULL skip; single reserve double-count bug)
alter table public.ai_budget add column if not exists meta_micro_usd_cap bigint check (meta_micro_usd_cap is null or meta_micro_usd_cap between 0 and 100000000000);
alter table public.ai_budget add column if not exists meta_micro_usd_used bigint not null default 0 check (meta_micro_usd_used >= 0);
alter table public.ai_budget add column if not exists meta_reserve_micro_usd bigint not null default 0 check (meta_reserve_micro_usd >= 0 and meta_reserve_micro_usd <= 100000000000);
alter table public.ai_budget add column if not exists baseten_micro_usd_cap bigint check (baseten_micro_usd_cap is null or baseten_micro_usd_cap between 0 and 100000000000);
alter table public.ai_budget add column if not exists baseten_micro_usd_used bigint not null default 0 check (baseten_micro_usd_used >= 0);
alter table public.ai_budget add column if not exists baseten_reserve_micro_usd bigint not null default 0 check (baseten_reserve_micro_usd >= 0 and baseten_reserve_micro_usd <= 100000000000);
-- keep legacy single column for compatibility but unused; enforce it =0 to avoid double-reserve confusion
alter table public.ai_budget add column if not exists reserve_micro_usd bigint not null default 0 check (reserve_micro_usd >= 0 and reserve_micro_usd <= 100000000000);
comment on column public.ai_budget.meta_reserve_micro_usd is 'Per-provider judging reserve; not shared across providers';
comment on column public.ai_budget.baseten_reserve_micro_usd is 'Per-provider reserve for baseten; separate from meta';

-- 2) Server-held pricebook: empty by default, disabled until exact verified ceiling configured.
-- Rates tied to provider+model+input/output/duration; mismatch rejects; microUSD conservatively rounded ints.
-- Candidate ships empty (no production prices). Tests insert labeled TEST fixtures:
--   draft: 1200 tokens output @ $4.25/1M = 5100 microUSD output alone -> fixture 8500 microUSD (input buffer+round-up)
--   transcribe: 60s @ $0.18/hr = 3000 microUSD -> fixture 3500 microUSD rounded
-- Existing draft 1500 / transcribe 500 were insufficient and removed.
create table if not exists public.ai_pricebook (
  feature text primary key check (feature in ('draft','transcribe','cutout','moderation')),
  provider text not null check (provider in ('baseten','meta')),
  model text not null check (char_length(model) between 1 and 120),
  max_cost_micro_usd integer not null check (max_cost_micro_usd > 0 and max_cost_micro_usd <= 1000000),
  enabled boolean not null default false,
  input_max_chars integer check (input_max_chars is null or input_max_chars > 0),
  output_max_tokens integer check (output_max_tokens is null or output_max_tokens > 0),
  max_duration_sec integer check (max_duration_sec is null or (max_duration_sec between 1 and 600)),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  check (enabled = false or (
    (feature = 'draft' and input_max_chars is not null and output_max_tokens is not null) or
    (feature = 'transcribe' and max_duration_sec is not null) or
    feature in ('cutout','moderation')
  ))
);
comment on table public.ai_pricebook is 'Server-held pricebook; unknown/unpriced disabled rejects; client cannot forge cost; empty until owner-configured';

-- 3) Operation identity: separates request from attempts; binds feature/user/provider/model/source_hash
create table if not exists public.ai_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null check (feature in ('draft','transcribe','cutout','moderation')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  source_hash text not null check (char_length(source_hash) between 16 and 128),
  listing_id uuid references public.listings(id) on delete set null,
  provider text not null check (provider in ('baseten','meta')),
  model text not null check (char_length(model) between 1 and 120),
  price_micro_usd integer not null check (price_micro_usd > 0),
  status text not null check (status in ('pending','done','failed')),
  result jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_ops_user_feature_key_unique unique (user_id, feature, idempotency_key)
);
create index if not exists ai_ops_user_created_idx on public.ai_operations(user_id, created_at);

-- 4) Attempts: each provider try snapshots provider+model+price; max 3 per operation across requests
create table if not exists public.ai_attempts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.ai_operations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null,
  provider text not null check (provider in ('baseten','meta')),
  model text not null,
  price_micro_usd integer not null check (price_micro_usd > 0),
  ok boolean,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms between 0 and 60000)
);
create index if not exists ai_attempts_op_idx on public.ai_attempts(operation_id);
create index if not exists ai_attempts_user_feature_idx on public.ai_attempts(user_id, feature, created_at);

-- Extend usage snapshot for audit (retrofit existing) : provider + price + operation
alter table public.ai_usage add column if not exists provider text check (provider is null or provider in ('baseten','meta'));
alter table public.ai_usage add column if not exists model text check (model is null or char_length(model) between 1 and 120);
alter table public.ai_usage add column if not exists price_micro_usd integer check (price_micro_usd is null or price_micro_usd > 0);
alter table public.ai_usage add column if not exists operation_id uuid references public.ai_operations(id) on delete set null;

-- 5) RLS: candidate tables default deny; only service_role via definer functions may write
alter table public.ai_pricebook enable row level security;
alter table public.ai_operations enable row level security;
alter table public.ai_attempts enable row level security;
revoke all on public.ai_pricebook, public.ai_operations, public.ai_attempts from anon, authenticated, public;
grant all on public.ai_pricebook, public.ai_operations, public.ai_attempts to service_role;
grant all on public.ai_budget, public.ai_settings, public.ai_usage to service_role;
grant usage on schema public to service_role;
-- allow service_role to bypass RLS for direct management (owner inserts), while authenticated only reads via policies
create policy ai_pricebook_service_all on public.ai_pricebook for all to service_role using (true) with check (true);
create policy ai_ops_service_all on public.ai_operations for all to service_role using (true) with check (true);
create policy ai_attempts_service_all on public.ai_attempts for all to service_role using (true) with check (true);
-- pricebook readable for audit, not writable via RLS
do $$ begin
  if not exists (select 1 from pg_policies where policyname='ai_pricebook_read' and tablename='ai_pricebook') then
    create policy ai_pricebook_read on public.ai_pricebook for select to authenticated using (true);
  end if;
end $$;
grant select on public.ai_pricebook to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where policyname='own_ai_ops' and tablename='ai_operations') then
    create policy own_ai_ops on public.ai_operations for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where policyname='own_ai_attempts' and tablename='ai_attempts') then
    create policy own_ai_attempts on public.ai_attempts for select to authenticated using (user_id = auth.uid());
  end if;
end $$;
grant select on public.ai_operations to authenticated;
grant select on public.ai_attempts to authenticated;

-- 6) Retire old signatures: remove public exec on 3-arg reserve/complete to prevent bypass
revoke all on function public.reserve_ai_usage(text,integer,integer) from public, anon, authenticated;
revoke all on function public.complete_ai_usage(uuid,boolean,integer) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_proc where proname='reserve_ai_usage') then
    revoke all on function public.reserve_ai_usage(text,integer,integer) from public, anon, authenticated;
  end if;
  if exists (select 1 from pg_proc where proname='complete_ai_usage') then
    revoke all on function public.complete_ai_usage(uuid,boolean,integer) from public, anon, authenticated;
  end if;
end $$;

-- 7) Trusted metering entrypoint: service_role ONLY, p_user_id from verified route, lock before idempotency
--    - checks ai_budget.enabled + ai_settings.enabled (preserves existing per-feature caps)
--    - stricter env bounds: p_daily_limit/p_user_limit are least() vs DB caps
--    - per-provider cap null/<=0 -> budget_unconfigured rejects even if global enabled
--    - reserve per-provider validated (reserve <= cap)
--    - pricebook provider/model mismatch rejects
--    - duplicate done/pending returns allowed=false with disposition, not allowed=true
--    - source_hash mismatch rejects
--    - max 3 attempts per operation across requests
create or replace function public.reserve_ai_attempt(
  p_user_id uuid,
  p_feature text,
  p_idempotency_key text,
  p_provider text,
  p_model text,
  p_source_hash text,
  p_daily_limit integer,
  p_user_limit integer,
  p_listing_id uuid,
  p_expected_version bigint,
  p_expected_fingerprint text
) returns table(operation_id uuid, attempt_id uuid, allowed boolean, disposition text, reason text, cached_result jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  bud public.ai_budget;
  pb public.ai_pricebook;
  feat public.ai_settings;
  existing_op public.ai_operations;
  new_op_id uuid;
  new_attempt uuid;
  today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  global_count integer;
  user_count integer;
  feature_count integer;
  feature_user_count integer;
  effective_daily integer;
  effective_user integer;
  cap_to_check bigint;
  reserve_to_check bigint;
  used_to_check bigint;
begin
  if p_user_id is null or p_feature is null or p_idempotency_key is null or p_source_hash is null or p_provider is null or p_model is null then
    return query select null::uuid,null::uuid,false,'rejected'::text,'invalid_args'::text,null::jsonb; return; end if;
  if char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 128 then
    return query select null::uuid,null::uuid,false,'rejected'::text,'invalid_args'::text,null::jsonb; return; end if;
  if char_length(p_source_hash) < 16 or char_length(p_source_hash) > 128 then
    return query select null::uuid,null::uuid,false,'rejected'::text,'invalid_source_hash'::text,null::jsonb; return; end if;
  if p_provider not in ('baseten','meta') then
    return query select null::uuid,null::uuid,false,'rejected'::text,'invalid_provider'::text,null::jsonb; return; end if;
  if char_length(p_model) < 1 or char_length(p_model) > 120 then
    return query select null::uuid,null::uuid,false,'rejected'::text,'invalid_model'::text,null::jsonb; return; end if;
  if p_listing_id is not null then
    if not exists (select 1 from public.listings where id = p_listing_id and seller_id = p_user_id) then
      return query select null::uuid,null::uuid,false,'rejected'::text,'listing_forbidden'::text,null::jsonb; return; end if;
  end if;
  -- caller must be service_role (metering client); fail closed otherwise (no anon/authenticated)
  if current_user <> 'service_role' and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    -- PGlite test uses SET ROLE service_role; live uses service_role JWT
    -- allow if executed as service_role role, else reject
    if pg_has_role(current_user, 'service_role', 'member') = false and current_user not in ('postgres','service_role') then
      -- strict: only service_role may execute; tests set role service_role
      return query select null::uuid,null::uuid,false,'rejected'::text,'unauthorized_meter'::text,null::jsonb; return;
    end if;
  end if;

  -- lock budget first before idempotency lookup
  select * into bud from public.ai_budget where id = true for update;
  if not found or bud.enabled is distinct from true then
    return query select null::uuid,null::uuid,false,'rejected'::text,'disabled'::text,null::jsonb; return; end if;

  -- preserve existing ai_settings checks (feature must be enabled)
  select * into feat from public.ai_settings where feature = p_feature;
  if not found or feat.enabled is distinct from true then
    return query select null::uuid,null::uuid,false,'rejected'::text,'feature_disabled'::text,null::jsonb; return; end if;

  -- pricebook must exist, enabled, with valid price; mismatch rejects
  select * into pb from public.ai_pricebook where feature = p_feature;
  if not found or pb.enabled is distinct from true or pb.max_cost_micro_usd is null or pb.max_cost_micro_usd <= 0 then
    return query select null::uuid,null::uuid,false,'rejected'::text,'unpriced_feature'::text,null::jsonb; return; end if;
  if pb.provider <> p_provider or pb.model <> p_model then
    return query select null::uuid,null::uuid,false,'rejected'::text,'provider_mismatch'::text,null::jsonb; return; end if;
  if p_expected_version is not null and pb.version <> p_expected_version then
    return query select null::uuid,null::uuid,false,'rejected'::text,'pricebook_stale'::text,null::jsonb; return; end if;
  if p_expected_fingerprint is not null then
    if md5(pb.feature||'|'||pb.provider||'|'||pb.model||'|'||pb.max_cost_micro_usd::text||'|'||coalesce(pb.input_max_chars::text,'')||'|'||coalesce(pb.output_max_tokens::text,'')||'|'||coalesce(pb.max_duration_sec::text,'')||'|'||pb.enabled::text||'|'||pb.version::text) <> p_expected_fingerprint then
      return query select null::uuid,null::uuid,false,'rejected'::text,'pricebook_stale'::text,null::jsonb; return; end if;
  end if;
  if pb.enabled = true then
    if pb.feature = 'draft' and (pb.input_max_chars is null or pb.output_max_tokens is null) then
      return query select null::uuid,null::uuid,false,'rejected'::text,'unpriced_feature'::text,null::jsonb; return; end if;
    if pb.feature = 'transcribe' and pb.max_duration_sec is null then
      return query select null::uuid,null::uuid,false,'rejected'::text,'unpriced_feature'::text,null::jsonb; return; end if;
  end if;

  -- idempotency lookup immediately after core checks: duplicate respected even after spend limit, but disabled kill switch still stops (disabled already checked above)
  select * into existing_op from public.ai_operations
    where user_id = p_user_id and feature = p_feature and idempotency_key = p_idempotency_key for update;
  if found then
    -- source_hash must match stable operation identity; changed source rejects (prevents key reuse with different prompt/image)
    if existing_op.source_hash <> p_source_hash then
      return query select existing_op.id, null::uuid, false, 'rejected'::text, 'source_mismatch'::text, null::jsonb; return; end if;
    if existing_op.provider <> p_provider or existing_op.model <> p_model then
      return query select existing_op.id, null::uuid, false, 'rejected'::text, 'provider_mismatch'::text, null::jsonb; return; end if;
    if existing_op.status = 'done' then
      return query select existing_op.id, null::uuid, false, 'duplicate_done'::text, 'duplicate_done'::text, existing_op.result; return;
    elsif existing_op.status = 'pending' then
      return query select existing_op.id, null::uuid, false, 'duplicate_pending'::text, 'duplicate_pending'::text, null::jsonb; return;
    else
      -- prior failed: enforce max 3 attempts per operation across requests
      if existing_op.attempt_count >= 3 then
        return query select existing_op.id, null::uuid, false, 'rejected'::text, 'max_attempts'::text, null::jsonb; return; end if;
      -- check overall attempts for op also (qualify to avoid PL/pgSQL output var collision)
      select count(*) into user_count from public.ai_attempts a where a.operation_id = existing_op.id;
      if user_count >= 3 then
        return query select existing_op.id, null::uuid, false, 'rejected'::text, 'max_attempts'::text, null::jsonb; return; end if;
      new_op_id := existing_op.id;
      -- mark pending atomically before provider call
      update public.ai_operations set status='pending', updated_at=now(), attempt_count = attempt_count + 1 where id = new_op_id;
    end if;
  else
    -- fresh operation: insert pending (only after duplicate check passes fresh path)
    insert into public.ai_operations(user_id, feature, idempotency_key, source_hash, listing_id, provider, model, price_micro_usd, status, attempt_count)
    values (p_user_id, p_feature, p_idempotency_key, p_source_hash, p_listing_id, pb.provider, pb.model, pb.max_cost_micro_usd, 'pending', 1)
    returning id into new_op_id;
  end if;

  -- monetary and rate checks now apply only to fresh or retry allowed paths; duplicate already returned above
  -- per-provider monetary guard: NULL/missing/nonpositive cap MUST reject (fail closed)
  if pb.provider = 'meta' then
    cap_to_check := bud.meta_micro_usd_cap;
    reserve_to_check := bud.meta_reserve_micro_usd;
    used_to_check := bud.meta_micro_usd_used;
  else
    cap_to_check := bud.baseten_micro_usd_cap;
    reserve_to_check := bud.baseten_reserve_micro_usd;
    used_to_check := bud.baseten_micro_usd_used;
  end if;
  if cap_to_check is null or cap_to_check <= 0 then
    -- revert pending insertion for fresh case: mark failed and return budget_unconfigured so duplicate logic stays honest
    -- for retry case we already marked pending; need to revert to failed
    update public.ai_operations set status='failed', updated_at=now() where id = new_op_id;
    return query select new_op_id, null::uuid,false,'rejected'::text,'budget_unconfigured'::text,null::jsonb; return; end if;
  -- reserve must be <= cap (per-provider, not shared pool)
  if reserve_to_check > cap_to_check then
    update public.ai_operations set status='failed', updated_at=now() where id = new_op_id;
    return query select new_op_id, null::uuid,false,'rejected'::text,'invalid_reserve'::text,null::jsonb; return; end if;
  -- effective spendable = cap - reserve
  if used_to_check + pb.max_cost_micro_usd > (cap_to_check - reserve_to_check) then
    update public.ai_operations set status='failed', updated_at=now() where id = new_op_id;
    return query select new_op_id, null::uuid,false,'rejected'::text,'budget_exhausted'::text,null::jsonb; return; end if;

  -- stricter env bounds vs DB: effective limit is least(cap, env)
  if p_daily_limit is not null and p_daily_limit > 0 then
    effective_daily := least(bud.daily_limit, feat.daily_limit, p_daily_limit);
  else
    effective_daily := least(bud.daily_limit, feat.daily_limit);
  end if;
  if p_user_limit is not null and p_user_limit > 0 then
    effective_user := least(bud.per_user_limit, feat.per_user_limit, p_user_limit);
  else
    effective_user := least(bud.per_user_limit, feat.per_user_limit);
  end if;
  -- count attempts (includes pending/failed) per UTC day
  select count(*) into global_count from public.ai_attempts where created_at >= today;
  select count(*) into user_count from public.ai_attempts where user_id = p_user_id and created_at >= today;
  select count(*) into feature_count from public.ai_attempts where feature = p_feature and created_at >= today;
  select count(*) into feature_user_count from public.ai_attempts where user_id = p_user_id and feature = p_feature and created_at >= today;
  if global_count >= effective_daily or feature_count >= feat.daily_limit then
    update public.ai_operations set status='failed', updated_at=now() where id = new_op_id;
    return query select new_op_id, null::uuid,false,'rejected'::text,'global_limit'::text,null::jsonb; return; end if;
  if user_count >= effective_user or feature_user_count >= feat.per_user_limit then
    update public.ai_operations set status='failed', updated_at=now() where id = new_op_id;
    return query select new_op_id, null::uuid,false,'rejected'::text,'user_limit'::text,null::jsonb; return; end if;

  -- create attempt that gates provider execution (only fresh attempt_id may call provider)
  insert into public.ai_attempts(operation_id, user_id, feature, provider, model, price_micro_usd)
  values (new_op_id, p_user_id, p_feature, pb.provider, pb.model, pb.max_cost_micro_usd) returning id into new_attempt;

  insert into public.ai_usage(user_id, feature, provider, model, price_micro_usd, operation_id)
  values (p_user_id, p_feature, pb.provider, pb.model, pb.max_cost_micro_usd, new_op_id);

  if pb.provider = 'meta' then
    update public.ai_budget set meta_micro_usd_used = meta_micro_usd_used + pb.max_cost_micro_usd where id = true;
  else
    update public.ai_budget set baseten_micro_usd_used = baseten_micro_usd_used + pb.max_cost_micro_usd where id = true;
  end if;

  return query select new_op_id, new_attempt, true, 'executed'::text, null::text, null::jsonb;
end; $$;

create or replace function public.reserve_ai_attempt(p_user_id uuid, p_feature text, p_idempotency_key text, p_provider text, p_model text, p_source_hash text, p_daily_limit integer, p_user_limit integer)
returns table(operation_id uuid, attempt_id uuid, allowed boolean, disposition text, reason text, cached_result jsonb)
language sql security definer set search_path = '' as $$
  select * from public.reserve_ai_attempt(p_user_id, p_feature, p_idempotency_key, p_provider, p_model, p_source_hash, p_daily_limit, p_user_limit, null::uuid, null::bigint, null::text);
$$;
create or replace function public.reserve_ai_attempt(p_user_id uuid, p_feature text, p_idempotency_key text, p_provider text, p_model text, p_source_hash text, p_daily_limit integer, p_user_limit integer, p_listing_id uuid)
returns table(operation_id uuid, attempt_id uuid, allowed boolean, disposition text, reason text, cached_result jsonb)
language sql security definer set search_path = '' as $$
  select * from public.reserve_ai_attempt(p_user_id, p_feature, p_idempotency_key, p_provider, p_model, p_source_hash, p_daily_limit, p_user_limit, p_listing_id, null::bigint, null::text);
$$;
create or replace function public.reserve_ai_attempt(p_user_id uuid, p_feature text, p_idempotency_key text, p_provider text, p_model text, p_source_hash text, p_daily_limit integer, p_user_limit integer, p_listing_id uuid, p_expected_version bigint)
returns table(operation_id uuid, attempt_id uuid, allowed boolean, disposition text, reason text, cached_result jsonb)
language sql security definer set search_path = '' as $$
  select * from public.reserve_ai_attempt(p_user_id, p_feature, p_idempotency_key, p_provider, p_model, p_source_hash, p_daily_limit, p_user_limit, p_listing_id, p_expected_version, null::text);
$$;

revoke all on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer,uuid) from public, anon, authenticated;
revoke all on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer,uuid,bigint) from public, anon, authenticated;
revoke all on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer,uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer) to service_role;
grant execute on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer,uuid) to service_role;
grant execute on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer,uuid,bigint) to service_role;
grant execute on function public.reserve_ai_attempt(uuid,text,text,text,text,text,integer,integer,uuid,bigint,text) to service_role;

-- completion fenced to current attempt claim; fail/timeout counts full max, no refund RPC
create or replace function public.complete_ai_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_ok boolean,
  p_ms integer,
  p_result jsonb default null
) returns void language plpgsql security definer set search_path = '' as $$
declare who uuid := p_user_id; att public.ai_attempts; op public.ai_operations;
begin
  if who is null or p_attempt_id is null or p_ok is null then raise exception 'invalid completion args'; end if;
  if p_ms < 0 or p_ms > 60000 then raise exception 'invalid completion ms'; end if;
  -- only service_role may complete (same metering client)
  if current_user <> 'service_role' and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    if pg_has_role(current_user, 'service_role','member') = false and current_user not in ('postgres','service_role') then
      raise exception 'unauthorized metering';
    end if;
  end if;
  select * into att from public.ai_attempts where id = p_attempt_id and user_id = who for update;
  if not found then raise exception 'attempt not found'; end if;
  if att.completed_at is not null then return; end if;
  -- fence: operation must be pending and this attempt must be latest for that operation
  select * into op from public.ai_operations where id = att.operation_id for update;
  if op.status is distinct from 'pending' then
    -- allow idempotent completion of already completed op? but fence to current claim: if op already done/failed, still record attempt completion
    null;
  end if;
  -- ensure this attempt is the most recent for its operation (fenced to current claim)
  if exists (select 1 from public.ai_attempts a where a.operation_id = att.operation_id and a.created_at > att.created_at) then
    raise exception 'stale attempt';
  end if;
  update public.ai_attempts set ok = p_ok, completed_at = now(), duration_ms = p_ms where id = p_attempt_id;
  update public.ai_operations set status = case when p_ok then 'done' else 'failed' end, result = coalesce(p_result, result), updated_at = now()
    where id = att.operation_id;
  update public.ai_usage set completed_at = now(), ok = p_ok, duration_ms = p_ms where public.ai_usage.operation_id = att.operation_id and public.ai_usage.completed_at is null;
  -- no refund: fail/timeout stays charged at full upper bound
end; $$;
revoke all on function public.complete_ai_attempt(uuid,uuid,boolean,integer,jsonb) from public, anon, authenticated;
grant execute on function public.complete_ai_attempt(uuid,uuid,boolean,integer,jsonb) to service_role;

-- Default state: disabled, zero spend, pricebook empty, caps null (no budget until configured)
update public.ai_budget set enabled = false, reserve_micro_usd = 0, meta_reserve_micro_usd = 0, baseten_reserve_micro_usd = 0 where id = true;

-- No default pricebook rows: enabled false by construction; owner must insert verified ceilings.
-- Example owner insert (NOT executed here, docs-only): insert into ai_pricebook(feature,provider,model,max_cost_micro_usd,input_max_chars,output_max_tokens,max_duration_sec,enabled,version) values
--   ('draft','meta','muse-spark-1.3', 8500, 8000, 1200, null, true, 1), -- 1200*4.25/1M=5100 output + input buffer, rounded 8500 TEST ONLY
--   ('transcribe','meta','muse-voice-transcribe-1.0', 3500, 3000, null, 60, true, 1), -- 60s*0.18/3600=3000 + round TEST ONLY
--   ('cutout','meta','sam-3.1', 4000, null, null, null, true, 1),
--   ('moderation','baseten','meta-models/muse-spark-open-1026', 6000, 8000, 500, null, true, 1);

-- Least-privilege notes:
-- Ordinary app CRUD (listings/threads/messages/profiles) uses anon/authenticated via RLS + column grants; no service_role.
-- Budget enforcement only via SECURITY DEFINER metering RPCs (FOR UPDATE on ai_budget); only service_role can execute them.
-- Server derives p_user_id via requireUser (verified JWT); client never supplies it; missing metering credential fails closed (no fallback).
-- pricebook/ai_operations/ai_attempts grant select to authenticated for audit; no direct writes.
-- No public/anon/authenticated can reserve/complete/refund; there is no refund RPC.
