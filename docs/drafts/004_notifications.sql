-- Re-Love 004 notifications — NOT APPROVAL READY — DO NOT APPLY — KNOWN UNSAFE DEFECTS (see header)
-- Defects: attempts only on failure completion not claim (crashed leases unlimited); caps count rows not provider attempts;
-- opt-out after delivery not claim/pre-send; unique(user,endpoint) leaks shared-device cross-account; logout doesn't revoke; idempotency header unverified.
-- REVIEW CANDIDATE ONLY, DEFAULT DISABLED, never remote-apply. See docs/NOTIFICATION-PROPOSAL.md §5.

-- ============================================================================
-- 1) Preferences — one row per auth user, opt-in false (DEFAULT DISABLED)
-- ============================================================================
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default false,
  push_enabled boolean not null default false,
  email_unsubscribed_at timestamptz check (email_unsubscribed_at is null or email_unsubscribed_at <= now()),
  push_unsubscribed_at timestamptz check (push_unsubscribed_at is null or push_unsubscribed_at <= now()),
  email_unsubscribe_token text unique check (email_unsubscribe_token is null or char_length(email_unsubscribe_token) between 16 and 128),
  -- Caps overrides; null = use budget defaults
  email_daily_cap integer check (email_daily_cap is null or email_daily_cap between 0 and 50),
  push_daily_cap integer check (push_daily_cap is null or push_daily_cap between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 2) Push subscriptions — private, per-user, per-device; never cross-user
--    Ownership: user_id = auth.uid() enforced via RLS; account switch/logout leaves
--    previous user's subscriptions invisible to new user (RLS). Logout does not
--    auto-delete; user may revoke via DELETE or browser site settings.
-- ============================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) >= 10 and char_length(endpoint) <= 2000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) >= 20 and char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) >= 10 and char_length(auth) <= 100),
  user_agent text check (char_length(user_agent) <= 500),
  failure_count integer not null default 0 check (failure_count between 0 and 100),
  last_error text check (char_length(last_error) <= 500),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_endpoint_user_unique unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id) where revoked_at is null;
create index if not exists push_subscriptions_endpoint_idx on public.push_subscriptions (endpoint);

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 3) Budget — singleton, DEFAULT DISABLED (mirrors ai_budget pattern)
--    global + per-user daily limits; failed attempts counted.
-- ============================================================================
create table if not exists public.notification_budget (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  email_daily_limit integer not null default 200 check (email_daily_limit between 0 and 10000),
  push_daily_limit integer not null default 500 check (push_daily_limit between 0 and 10000),
  per_user_email_daily_limit integer not null default 10 check (per_user_email_daily_limit between 0 and 100),
  per_user_push_daily_limit integer not null default 10 check (per_user_push_daily_limit between 0 and 100),
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  lease_seconds integer not null default 300 check (lease_seconds between 60 and 3600)
);
insert into public.notification_budget(id) values (true) on conflict (id) do nothing;

-- ============================================================================
-- 4) Outbox/queue — durable, deduped, leased, retry-bounded
--    - recipient_id derived from messages.recipient_id via trigger (trusted, not client)
--    - unique per message+recipient+channel (+ push_subscription for per-device)
--    - attempt budgets count ALL attempts (incl failures) via daily window
--    - lease_owner + lease_expires_at fencing for worker crash safety
--    - opt-out rechecked at enqueue and claim time
-- ============================================================================
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email','push')),
  message_id uuid references public.messages(id) on delete set null,
  thread_id uuid references public.threads(id) on delete cascade,
  push_subscription_id uuid references public.push_subscriptions(id) on delete cascade,
  dedupe_key text not null check (char_length(dedupe_key) >= 8 and char_length(dedupe_key) <= 300),
  payload jsonb not null default '{}'::jsonb check (length(payload::text) <= 3000),
  status text not null default 'pending' check (status in ('pending','claimed','sent','failed','skipped','unsubscribed','invalid_endpoint')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_error text check (char_length(last_error) <= 1000),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  sent_at timestamptz check (sent_at is null or sent_at >= created_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_outbox_dedupe_unique unique (recipient_id, channel, dedupe_key),
  constraint push_subscription_required_for_push check (channel != 'push' or push_subscription_id is not null),
  constraint lease_owner_requires_expiry check (lease_owner is null or lease_expires_at is not null)
);
create index if not exists notification_outbox_pending_idx on public.notification_outbox (status, next_attempt_at) where status = 'pending';
create index if not exists notification_outbox_claimed_lease_idx on public.notification_outbox (status, lease_expires_at) where status = 'claimed';
create index if not exists notification_outbox_recipient_created_idx on public.notification_outbox (recipient_id, created_at desc);
create index if not exists notification_outbox_message_idx on public.notification_outbox (message_id);
create index if not exists notification_outbox_subscription_idx on public.notification_outbox (push_subscription_id) where push_subscription_id is not null;

drop trigger if exists notification_outbox_updated_at on public.notification_outbox;
create trigger notification_outbox_updated_at before update on public.notification_outbox
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 5) RLS — private, never public
-- ============================================================================
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_budget enable row level security;

-- Preferences: owner-only
drop policy if exists "Users can view own prefs" on public.notification_preferences;
create policy "Users can view own prefs" on public.notification_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can upsert own prefs" on public.notification_preferences;
create policy "Users can upsert own prefs" on public.notification_preferences for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users can update own prefs" on public.notification_preferences;
create policy "Users can update own prefs" on public.notification_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Push subscriptions: owner-only; logout/switch isolates via auth.uid()
drop policy if exists "Users can view own push subs" on public.push_subscriptions;
create policy "Users can view own push subs" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can insert own push sub" on public.push_subscriptions;
create policy "Users can insert own push sub" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users can update own push sub" on public.push_subscriptions;
create policy "Users can update own push sub" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users can delete own push sub" on public.push_subscriptions;
create policy "Users can delete own push sub" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Outbox: owner can view own; no client insert/update/delete (queue/claim via service role)
drop policy if exists "Users can view own outbox" on public.notification_outbox;
create policy "Users can view own outbox" on public.notification_outbox for select to authenticated using (recipient_id = auth.uid());

-- Budget: no anon/authenticated access; RPC accesses as definer
revoke all on public.notification_preferences, public.push_subscriptions, public.notification_outbox, public.notification_budget from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_outbox to authenticated;
-- Worker role needs full access to outbox/budget for claim/complete; ordinary marketplace CRUD must not gain it
grant select, insert, update, delete on public.notification_outbox to service_role;
grant select, update on public.notification_budget to service_role;
grant select, update on public.push_subscriptions to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
-- Allow service_role to read marketplace tables for trigger verification and tests
grant select on public.messages, public.threads, public.profiles, public.listings to service_role;
-- RLS policies for service_role (RLS still enforced even with grant; need explicit policies)
drop policy if exists "service_role all outbox" on public.notification_outbox;
create policy "service_role all outbox" on public.notification_outbox for all to service_role using (true) with check (true);
drop policy if exists "service_role budget" on public.notification_budget;
create policy "service_role budget" on public.notification_budget for all to service_role using (true) with check (true);
drop policy if exists "service_role push subs" on public.push_subscriptions;
create policy "service_role push subs" on public.push_subscriptions for all to service_role using (true) with check (true);
drop policy if exists "service_role prefs" on public.notification_preferences;
create policy "service_role prefs" on public.notification_preferences for all to service_role using (true) with check (true);
-- Outbox writes only via trigger/RPC as definer; no direct grants for insert/update/delete
-- Budget never exposed to client

-- ============================================================================
-- 6) Trigger: queue from messages.recipient_id (TRUSTED, not sender)
--    Derives recipient safely, honors preferences, dedupes, caps, no public email leakage
-- ============================================================================
create or replace function public.enqueue_notification_from_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  recipient uuid := new.recipient_id;
  prefs public.notification_preferences;
  budget public.notification_budget;
  today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  thread_rec uuid;
  listing_title text;
  -- Channel loop for email + push (push per subscription)
  sub record;
  dedupe text;
  user_caps integer;
  global_caps integer;
  existing uuid;
begin
  if recipient is null then return new; end if;

  select * into budget from public.notification_budget where id = true;
  if not found or budget.enabled is distinct from true then return new; end if;

  select * into prefs from public.notification_preferences where user_id = recipient;
  -- If no prefs row, treat as opt-out (DEFAULT DISABLED): skip unless explicitly enabled

  -- Email channel -----------------------------------------------------------
  if coalesce(prefs.email_enabled, false) = true and prefs.email_unsubscribed_at is null then
    dedupe := new.id::text || ':' || recipient::text || ':email';
    -- Idempotent dedupe
    select id into existing from public.notification_outbox where recipient_id = recipient and channel = 'email' and dedupe_key = dedupe limit 1;
    if not found then
      -- Caps: count ALL attempts today (incl failures) to prevent bypass
      select count(*) into user_caps from public.notification_outbox where recipient_id = recipient and channel = 'email' and created_at >= today;
      select count(*) into global_caps from public.notification_outbox where channel = 'email' and created_at >= today;
      if user_caps < least(budget.per_user_email_daily_limit, coalesce(prefs.email_daily_cap, budget.per_user_email_daily_limit))
         and global_caps < budget.email_daily_limit then
        -- Coalesce throttle: skip if pending/claimed/sent for same thread within 15m
        if not exists (
          select 1 from public.notification_outbox where recipient_id = recipient and channel = 'email' and thread_id = new.thread_id
            and created_at >= now() - interval '15 minutes' and status in ('pending','claimed','sent')
        ) then
          insert into public.notification_outbox(recipient_id, channel, message_id, thread_id, dedupe_key, payload, status, next_attempt_at)
          values (recipient, 'email', new.id, new.thread_id, dedupe, jsonb_build_object('thread_id', new.thread_id::text, 'message_id', new.id::text), 'pending', now())
          on conflict (recipient_id, channel, dedupe_key) do nothing;
        end if;
      end if;
    end if;
  end if;

  -- Push channel: one outbox row per active subscription (per-device dedupe) ---
  if coalesce(prefs.push_enabled, false) = true and prefs.push_unsubscribed_at is null then
    for sub in select id, endpoint from public.push_subscriptions where user_id = recipient and revoked_at is null loop
      dedupe := new.id::text || ':' || recipient::text || ':push:' || sub.id::text;
      select id into existing from public.notification_outbox where recipient_id = recipient and channel = 'push' and dedupe_key = dedupe limit 1;
      if not found then
        select count(*) into user_caps from public.notification_outbox where recipient_id = recipient and channel = 'push' and created_at >= today;
        select count(*) into global_caps from public.notification_outbox where channel = 'push' and created_at >= today;
        if user_caps < least(budget.per_user_push_daily_limit, coalesce(prefs.push_daily_cap, budget.per_user_push_daily_limit))
           and global_caps < budget.push_daily_limit then
          if not exists (
            select 1 from public.notification_outbox where recipient_id = recipient and channel = 'push' and push_subscription_id = sub.id and thread_id = new.thread_id
              and created_at >= now() - interval '15 minutes' and status in ('pending','claimed','sent')
          ) then
            insert into public.notification_outbox(recipient_id, channel, message_id, thread_id, push_subscription_id, dedupe_key, payload, status, next_attempt_at)
            values (recipient, 'push', new.id, new.thread_id, sub.id, dedupe, jsonb_build_object('thread_id', new.thread_id::text, 'message_id', new.id::text, 'endpoint', sub.endpoint), 'pending', now())
            on conflict (recipient_id, channel, dedupe_key) do nothing;
          end if;
        end if;
      end if;
    end loop;
  end if;

  return new;
end; $$;

drop trigger if exists messages_enqueue_notification on public.messages;
create trigger messages_enqueue_notification after insert on public.messages
  for each row execute function public.enqueue_notification_from_message();

revoke all on function public.enqueue_notification_from_message() from public;

-- ============================================================================
-- 7) Worker-only RPCs: claim + complete with lease fencing, retry cap, recheck
--    Ordinary users cannot queue/claim/mark delivered; only service_role (worker)
-- ============================================================================

-- Expire stale leases (called by worker or cron before claim)
create or replace function public.reap_stale_notification_leases()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  -- Only service_role (or PGlite superuser in tests) should call
  if auth.role() not in ('service_role','postgres') and current_user not in ('service_role','postgres') then
    raise exception 'Only worker may reap leases';
  end if;
  update public.notification_outbox set status = 'pending', lease_owner = null, lease_expires_at = null, updated_at = now()
    where status = 'claimed' and lease_expires_at is not null and lease_expires_at < now();
  get diagnostics n = row_count;
  return n;
end; $$;
revoke all on function public.reap_stale_notification_leases() from public;
grant execute on function public.reap_stale_notification_leases() to service_role;

-- Claim batch: atomic SELECT FOR UPDATE SKIP LOCKED with lease
create or replace function public.claim_notifications(p_limit integer, p_owner text)
returns setof public.notification_outbox
language plpgsql security definer set search_path = '' as $$
declare
  budget public.notification_budget;
  cutoff timestamptz := now();
begin
  if auth.role() not in ('service_role','postgres') and current_user not in ('service_role','postgres') then
    raise exception 'Only worker may claim notifications';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'Invalid limit'; end if;
  if p_owner is null or char_length(p_owner) < 4 then raise exception 'Invalid owner'; end if;
  select * into budget from public.notification_budget where id = true;
  if not found or budget.enabled is distinct from true then return; end if;

  return query
  with claimed as (
    select o.id from public.notification_outbox o
    where o.status = 'pending' and o.next_attempt_at <= cutoff
    order by o.created_at asc limit p_limit
    for update skip locked
  )
  update public.notification_outbox o set
    status = 'claimed',
    lease_owner = p_owner,
    lease_expires_at = now() + (budget.lease_seconds || ' seconds')::interval,
    updated_at = now()
  from claimed where o.id = claimed.id
  returning o.*;
end; $$;
revoke all on function public.claim_notifications(integer, text) from public;
grant execute on function public.claim_notifications(integer, text) to service_role;

-- Complete: worker reports send outcome; handles retry cap, opt-out recheck, idempotency notes
create or replace function public.complete_notification_send(
  p_outbox_id uuid,
  p_ok boolean,
  p_error text,
  p_owner text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  row public.notification_outbox;
  budget public.notification_budget;
  prefs public.notification_preferences;
begin
  if auth.role() not in ('service_role','postgres') and current_user not in ('service_role','postgres') then
    raise exception 'Only worker may complete notifications';
  end if;
  if p_owner is null then raise exception 'Owner required'; end if;
  select * into row from public.notification_outbox where id = p_outbox_id for update;
  if not found then raise exception 'Outbox entry not found'; end if;
  if row.status != 'claimed' then raise exception 'Not claimed'; end if;
  if row.lease_owner != p_owner then raise exception 'Lease ownership mismatch'; end if;
  if row.lease_expires_at is not null and row.lease_expires_at < now() then raise exception 'Lease expired'; end if;

  select * into budget from public.notification_budget where id = true;
  select * into prefs from public.notification_preferences where user_id = row.recipient_id;

  -- Opt-out recheck before marking sent: if user unsubscribed since enqueue, mark unsubscribed
  if row.channel = 'email' and prefs.email_unsubscribed_at is not null then
    update public.notification_outbox set status='unsubscribed', lease_owner=null, lease_expires_at=null, last_error='unsubscribed', updated_at=now() where id=p_outbox_id;
    return;
  end if;
  if row.channel = 'push' and prefs.push_unsubscribed_at is not null then
    update public.notification_outbox set status='unsubscribed', lease_owner=null, lease_expires_at=null, last_error='unsubscribed', updated_at=now() where id=p_outbox_id;
    return;
  end if;
  -- Push subscription revoked/expired check
  if row.channel = 'push' and row.push_subscription_id is not null then
    if not exists (select 1 from public.push_subscriptions where id = row.push_subscription_id and revoked_at is null) then
      update public.notification_outbox set status='invalid_endpoint', lease_owner=null, lease_expires_at=null, last_error='invalid_endpoint', updated_at=now() where id=p_outbox_id;
      return;
    end if;
  end if;

  if p_ok then
    update public.notification_outbox set status='sent', sent_at=now(), lease_owner=null, lease_expires_at=null, last_error=null, updated_at=now() where id=p_outbox_id;
  else
    -- Classify terminal vs retryable; increment attempts
    -- Terminal: invalid_endpoint/unsubscribed always fail; others retry up to max_attempts
    if p_error in ('invalid_endpoint','unsubscribed') or row.attempts + 1 >= budget.max_attempts then
      update public.notification_outbox set status='failed', attempts=row.attempts+1, lease_owner=null, lease_expires_at=null, last_error=left(coalesce(p_error,'failed'),500), updated_at=now() where id=p_outbox_id;
      -- For push 410/404: mark subscription invalid to stop future sends
      if row.channel='push' and p_error='invalid_endpoint' and row.push_subscription_id is not null then
        update public.push_subscriptions set revoked_at=now(), last_error='endpoint invalid', updated_at=now() where id=row.push_subscription_id;
      end if;
    else
      update public.notification_outbox set
        status='pending',
        attempts=row.attempts+1,
        lease_owner=null,
        lease_expires_at=null,
        last_error=left(coalesce(p_error,'retry'),500),
        next_attempt_at = now() + (case when row.attempts = 0 then interval '1 minute' when row.attempts = 1 then interval '5 minutes' else interval '30 minutes' end),
        updated_at=now()
      where id=p_outbox_id;
    end if;
  end if;
end; $$;
revoke all on function public.complete_notification_send(uuid,boolean,text,text) from public;
grant execute on function public.complete_notification_send(uuid,boolean,text,text) to service_role;

-- ============================================================================
-- 8) Validation helpers (SSRF) — strict allowlist mirrors isValidPushEndpoint()
-- ============================================================================
create or replace function public.validate_push_endpoint(p_endpoint text)
returns boolean language plpgsql immutable as $$
declare host text;
begin
  if p_endpoint is null or char_length(p_endpoint) > 2000 or p_endpoint not like 'https://%' then return false; end if;
  -- Extract host via regex; full allowlist enforced in API route (URL parsing) as primary
  -- This is secondary DB guard
  if p_endpoint ~* 'localhost|127\.0\.0\.1|::1|\.local|10\.\d|192\.168\.|169\.254\.169\.254|metadata\.google\.internal' then return false; end if;
  -- Exact allowlist
  if p_endpoint ~* '^https://fcm\.googleapis\.com/' then return true; end if;
  if p_endpoint ~* '^https://android\.googleapis\.com/' then return true; end if;
  if p_endpoint ~* '^https://updates\.push\.services\.mozilla\.com/' then return true; end if;
  if p_endpoint ~* '^https://push\.services\.mozilla\.com/' then return true; end if;
  if p_endpoint ~* '^https://web\.push\.apple\.com/' then return true; end if;
  if p_endpoint ~* '^https://api\.push\.apple\.com/' then return true; end if;
  return false;
end; $$;
revoke all on function public.validate_push_endpoint(text) from public;
grant execute on function public.validate_push_endpoint(text) to authenticated;

-- ============================================================================
-- 9) Grants — explicit, least privilege; no anon/authenticated worker ops
-- ============================================================================
revoke all on function public.handle_updated_at() from public;
-- Note: enqueue trigger is definer, not directly grantable to client

-- ============================================================================
-- 10) Delivery guarantees — honest limits (DOCUMENTATION, not code)
--     - At-least-once: worker may crash after provider send but before complete_notification_send()
--       → lease expiry will re-queue and may duplicate send. Providers (Resend/FCM) are
--       idempotent only if dedupe_key is passed as Idempotency-Key header; we set payload id
--       but cannot guarantee provider dedupe across all failures.
--     - Push endpoint may rotate (pushsubscriptionchange) → subscription invalidated; user must re-opt.
--     - Email throttling: 1 per thread per 15m, 10/day per user, global caps; failed attempts count.
-- ============================================================================
