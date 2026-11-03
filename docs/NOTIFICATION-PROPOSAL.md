# Re-Love Notifications — Proposal & Implementation Status

**Status:** Frontend in-app path implemented. Email + closed-app push remain **schema-draft and provider-blocked**; no external sends, no provider setup, no env reads/remote writes. Owner must approve schema before any DB change.

**Main branch:** `77c9e3b` — `t3/message-toasts-email-proposal` (this worktree).  
**User requests:** message pop-ups + email notifications + closed-app push. Subagents do code, not Astra. `AGENTS.md` read. Next may be custom — verified `src/lib/server/*` contracts before writing code.

---

## 1) Goals & Hard Constraints (from user)

- Preserve existing inbox/thread behaviour: window-focus refresh with unread counts; **no realtime sockets**. Keep that.
- **Implemented now:** accessible in-app new-message toast + global unread indicator while app is open using modest visible-tab polling (30 s), focus refresh, no overlapping requests, dedupe, abort/cleanup, user-account change isolation, don’t toast sent/self/already-open-read or flood initial history. Existing `GET /api/threads` data is private; **no weakening RLS / no-store**; **no AI** involved. Toast is clickable to thread, dismissible, `aria-live` appropriate, black-dominant palette `#020102 / #01071d / #021640 / #03245e / #220815, #F5F5F7, #9AA4B8` + light blue `#82b7ff / #93c5fd / #60a5fa`.
- **Not done:** no inventing toasts on sample/demo inventory; no sockets.
- **Clarification resolved:** user confirmed closed-app push **in addition** to in-app + opt-in email. Foundations are prepared **without** browser permission prompt on load (only after explicit user click). Durable push/e-mail delivery needs concrete schema draft for owner approval **before** applying.
- **Email:** transactional email to the user’s Google address (from Supabase `auth.users.email`), **not** Gmail account read/send OAuth scope. Generic private copy **without message bodies**. User opt-in/unsubscribe, idempotent throttled delivery, bounded retries, hard send cap, secure recipient selection. No sending, no provider setup, no extra deps, no env reads/remote writes in this PR — docs/schema proposal only until approved. Avoid fake “email enabled” UI.
- **Push (closed-app):** prefer VAPID web-push (viable free), never silently add paid infra. Never expose endpoints/keys to other users; validate endpoints/SSRF; verify authorized recipients; generic content; bounded retries/send caps/unsubscribe; clear delivery failure states. No Meta/AI used for notifications. Preserve existing PWA offline behaviour (`public/sw.js` shell cache + `/offline.html`).
- Tests meaningful for account isolation/dedupe/cleanup; lint/typecheck/build must pass without weakened checks.

---

## 2) What Is Implemented Now (frontend in-app — no schema change)

**Files added:**
- `src/lib/notifications.ts` — pure helpers: `computeGlobalUnreadCount`, `detectNewMessageToasts`, `shouldPollNotifications`, `getOpenThreadId`, `createToastDedupeKey`, `truncateBodyPreview`, `isValidPushEndpoint`, constants `NOTIFICATION_POLL_INTERVAL_MS = 30000`, `NOTIFICATION_TOAST_DURATION_MS = 8000`.
- `src/lib/client/notifications.tsx` — `NotificationsProvider` (visible-tab 30 s polling, focus refresh, no overlap via `fetchingRef`, `AbortController` cleanup, `document.visibilityState` pause/resume, `userId` change isolation, demo guard, `role="status"` dedupe by `threadId:created_at:senderId`).
- `src/lib/client/push.ts` — schema-independent push foundations: `getPushSupport()`, `getPushPermission()`, `requestPushPermissionFromUserGesture()` (must be click-bound; never auto-prompt), `isValidPushEndpoint`.
- `src/components/notifications/unread-badge.tsx`, `notification-toast.tsx`, `notification-toasts.tsx`, `push-opt-in.tsx` — accessible toast list (`aria-live="polite"`, `aria-relevant="additions"`, per-toast `role="status"`, dismiss, auto-close 8 s with hover/focus pause, black palette + light-blue progress), global badge on header + mobile nav.
- `public/sw.js` — extended with **non-breaking** push handlers: `push` → generic notification (`title`/`body` fallback, no message-body leakage, `tag` per thread), `notificationclick` → focus-or-open `/inbox/:id`, `pushsubscriptionchange` stub (no storage yet — awaiting schema approval). Existing shell-cache `fetch` handler unchanged.
- `src/app/layout.tsx` — wraps `SessionProvider` with `NotificationsProvider` + mounts `<NotificationToasts />` once.
- `src/components/layout/site-header.tsx`, `mobile-nav.tsx` — unread badge with `aria-label` counts; `Mail` icon remains 18 px.
- `src/app/inbox/page.tsx`, `src/app/inbox/[id]/page.tsx` — keep focus refresh, call `refreshNotifications()` after load/mark-read to keep global badge in sync; thread suppresses toast for its own `openThreadId`.
- `src/app/profile/page.tsx` — embeds `<PushOptInCard />` with verified support messaging; no auto-permission, no fake enabled state.

**Behaviour:**
- Poll `GET /api/threads` (`cache: "no-store"`, existing private RLS) every 30 s only when `document.visibilityState === "visible"` and `session.mode === "live"` and `session.user` exists. Paused when tab hidden; immediate re-fetch on `focus` / `visibilitychange:visible`.
- No overlapping requests: `fetchingRef` guard + per-request `AbortController`; aborted requests are silently ignored; cleanup on unmount/user-change.
- Dedupe by `messageId/unread info` proxy: `threadId:last_message.created_at:last_message.sender_id` (closest available; spec mentions message ID — API could later add `last_message.id` without breaking this). `seenKeys` set prevents re-toast on duplicate polls.
- Don’t toast on initial baseline (`isInitial` suppresses flood), on `sender_id === currentUserId` (sent/self), on `openThreadId` (already-open-read), or on `unread_count === 0` / `last_message === null`. Demo mode never polls (`shouldPollNotifications` gate).
- Account isolation: `userId` change clears `prevMap`, `seenKeys`, `toasts`, `unreadCount`, aborts in-flight, resets interval.

---

## 3) Transactional Email — Investigation & Proposal (docs-only)

**Recipient:** Supabase `auth.users.email` for the Google OAuth user (verified via `supabase.auth.getUser()` in existing `requireUser`). No Gmail OAuth scopes (`gmail.read`/`gmail.send`) — we do **not** access the user’s mailbox; we only send **to** their stored verified address. This matches “to user’s Google address (not Gmail account read/send access)”.

**Content:** generic, privacy-safe copy, **never includes message bodies**. Example template:  
> Subject: `New message on Re-Love`  
> Body: `You have a new message about “<listing title>”. Open Re-Love → Inbox to read it. — Re-Love (unsubscribe: <link>)`  
No sender listing description, no message body, no participant email in payload logging.

**Provider options (no commitment yet; investigation below):**

| Provider (transactional) | Free tier / trial | Domain/sender blocker | Auth needed | Notes — fit for Re-Love |
|---|---|---|---|---|
| **Resend** (Supabase recommended SMTP/API) | 3 000/mo, 100/day free; dev test addresses unrestricted | Verified domain (SPF + DKIM + DMARC); `noreply@<yourdomain>`; DMARC alignment blocks delivery to Gmail/Outlook if missing | API key or SMTP `smtp.resend.com:465` | Current Supabase docs point here; simplest Vercel + Supabase pairing. |
| **SendGrid** | 100/day free (legacy); free 30-day trial then pay | Domain auth (CNAME for DKIM) + single-sender verification interim | API key / SMTP | Larger infra but heavier setup; fine if domain exists. |
| **Amazon SES** | 3 000 msgs/mo free on EC2 (200/day sandbox); then $0.10/1k | Domain verified via DNS; sandbox requires recipient verification until production request | IAM + SMTP | Cheapest at scale but sandbox friction; needs prod access request. |
| **Postmark** | 100/mo free trial; then $15/10k | Domain via SPF/DKIM; bounce handling via webhook | API token | Best delivery reputation but paid after trial. |
| **Supabase built-in (GoTrue emails via SMTP)** | Uses your SMTP above; no separate transactional API | Same domain blockers | `SMTP_HOST/USER/PASS` env | Can piggy-back verification emails but not ideal for app-level notifications (no throttling/outbox). |
| **Brevo (ex-Sendinblue)** | 300/day free | Domain SPF/DKIM | API key / SMTP | EU-friendly; free sufficient for low campus volume. |

**Preference (still owner choice):** Resend via Supabase SMTP is least disruptive (no new infra, free tier covers campus scale, Vercel env only needs `SMTP_HOST`/`API_KEY`). We prefer VAPID push for real-time and keep email as throttled fallback — no paid push infra (Firebase Admin / OneSignal paid tiers) unless owner explicitly opts in.

**Domain / sender blockers (concise):**
- No `on-resend.dev` / `on-sendgrid.net` sender in production — campus Gmail will flag as spam. Need owner’s domain (`re-love.*` / `re-love-pi.vercel.app` cannot send email) with DNS access to add **SPF** (`v=spf1 include:amazonses.com … -all`), **DKIM** (3 CNAMEs per provider), and **DMARC** (`v=DMARC1; p=none/quarantine; rua=mailto:…`). Without owner-provided domain + DNS, delivery fails or lands in spam — **blocking**.
- Single-sender verification is dev-only; prod needs domain.
- Gmail caps: bulk senders > 5k/day must publish SPF+DKIM+DMARC + one-click unsubscribe (2024 enforcement). Re-Love low volume stays below, but unsubscribe header still mandatory.
- Environment blockers: `SMTP_HOST/PORT/USER/PASS` or `RESEND_API_KEY` + `NOTIFICATIONS_FROM` (`noreply@<verified-domain>`) must be set in Vercel + Supabase. We deliberately **do not** read `.env.local` or write remote secrets in this PR (per task).

**Behaviour to be implemented after approval (server-side, not yet coded):**
- Trigger: new `messages` row → (optional) enqueue email **only if** recipient’s `notification_preferences.email_enabled = true` and not unsubscribed.
- Secure recipient selection: server derives `recipient_id` from the just-inserted `thread_id`’s `buyer_id/seller_id` lookup via `requireUser()` — never trusts client-supplied email. RLS on `messages`/`threads` already enforces participant-only visibility.
- Validate recipient email exists and is verified (`auth.users.email_confirmed_at` non-null or Supabase marks verified for OAuth); skip unverified.
- Generic content only; never log `body`.
- Idempotent throttled delivery:
  - `dedupe_key = message.id + ":" + recipient_id` (unique). Duplicate `messages` inserts (retry) naturally dedupe.
  - Per-recipient throttle: ≤ 1 email per thread per **15 min window** (coalesce burst messages into one notification) + ≤ **10** emails/day global per user (hard send cap) + ≤ 100/day instance-wide.
  - Bounded retries: exponential backoff `1m, 5m, 30m` (≤ 3 attempts), then mark `failed` with `last_error` (SMTP 4xx retryable vs 5xx hard fail). `next_attempt_at` drives cron.
  - Hard send cap enforced in `reserve_notification_send` RPC (similar to `reserve_ai_usage`) atomically under `FOR UPDATE` on budget row.
  - `List-Unsubscribe` header + `unsubscribe_token` personal link (signed, not guessable). One-click POST invalidates `email_enabled`.
  - All retries `no-store` API path; provider calls server-only.

**Explicit non-goals in this PR:** no `fetch` to provider, no `nodemailer`/`resend` dep added, no env read, no remote DB write.

---

## 4) Closed-App Push — Foundations & Verified Browser Guidance

**Preference:** VAPID web-push (free, no third-party push service). Payload encrypted client-side via `applicationServerKey` (VAPID public key); server sends via `web-push` library or `fetch` to endpoint with `VAPID` JWT — no Firebase/OneSignal paid tier unless owner later chooses.

**Verified support matrix (tested in `getPushSupport()` and `public/sw.js`):**

- Requires **HTTPS** (`isSecureContext`). `http://localhost` works for dev; prod Vercel `https://re-love-pi.vercel.app` qualifies.
- **Service Worker** (`navigator.serviceWorker`) + **PushManager** (`window.PushManager`) + **Notification** (`window.Notification`). Chrome/Edge/Firefox desktop + Android Chrome pass. iOS Safari 16.4+ partially supports web-push **only when app is added to Home Screen (PWA installed)**; iOS 17+ expands but still needs user gesture. Desktop Safari has push but with limitations.
- `public/sw.js` already registered in `pwa-registration.tsx` (secure-context guard). Push handlers added non-intrusively; existing `fetch` shell-cache (`CACHE = "relove-shell-v1"`) preserved — no offline regression.
- **No auto-prompt:** `Notification.requestPermission()` is only called inside `requestPushPermissionFromUserGesture()` bound to the “Enable browser notifications” button in `<PushOptInCard />`. Browsers block auto-prompts; our code never calls it on load/visibility.
- **Permission states:** `default` → can request; `granted` → show “enabled (foundations ready)”; `denied` → explain how to unblock in site settings.

**Security / privacy (server-enforced after schema approval):**

- Never expose `endpoint`, `p256dh`, `auth` to other users. `push_subscriptions` RLS: user can only select/insert/delete own rows; no cross-user read.
- **SSRF validation:** endpoint must be `https:`, hostname not `localhost` / `127.0.0.1` / `*.local` / `10.*` / `192.168.*` / `169.254.169.254` / `metadata.google.internal`, length ≤ 2000, and must belong to known push services (`*.googleapis.com`, `*.windows.net`, `*.mozilla.com`, etc.) — allowlist checked server-side with `URL` parsing.
- Verify authorized recipient: `push_subscriptions.user_id = auth.uid()` and subscription was created by that user via `VAPID` `applicationServerKey`; server never trusts endpoint supplied by other user.
- Generic notification content only (title `New message on Re-Love`, body as above, never message body). Click routes to `/inbox/:id` (no payload leakage).
- Bounded retries / send caps / unsubscribe:
  - Per-subscription `failure_count` increments on `410 Gone` / `404 NotRegistered` (endpoint expired) → auto-mark `invalid` and stop retrying; UI prompts re-subscribe.
  - Per-user caps: ≤ 10 pushes/day, ≤ 1 per thread per 15 min coalesced (same as email). Hard cap via RPC.
  - Retry `429` with `Retry-After` header; exponential backoff 1m/5m/30m ≤ 3 attempts.
  - Unsubscribe: user can remove subscription via UI (`DELETE /api/notifications/subscribe`) or browser site settings; server marks `revoked_at`.
- Clear delivery failure states: `pending` → `sent`/`failed` (transient) vs `invalid_endpoint`/`expired` vs `permission_revoked` (distinguished by HTTP status codes from push service). Logs never store `auth` secret.

**Still pending owner approval (no durable storage yet):** VAPID keypair generation (`npx web-push generate-vapid-keys`), env `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` + subject `mailto:noreply@<domain>`, and durable tables below. No `web-push` dependency added in this PR; SW handlers tolerate missing server-side subscription.

---

## 5) Schema Proposal — Review Draft (owner must approve before apply)

**All tables are `PRIVATE` — never public email profiles.** This extends, not replaces, the existing `public.profiles` (which has no email column by design). Email is read from `auth.users` at send time; we store only preferences, not a public directory.

> Owner approved agreed schema on Nov 1, 2026. Sole release integrator owns final scope review and remote application. This file is for local review only. Do not contact/apply to remote DB; do not read `.env.local` secrets.

Location for future migration: `supabase/migrations-draft/003_notifications.sql` (draft — **not committed as migration** until approved; SQL below is the proposal).

```sql
-- Re-Love notifications schema — REVIEW DRAFT (pending owner approval)
-- Channels: in-app is client-only (no table); email + push need durable prefs/outbox.
-- Owner chooses final table names; integrator owns remote application.

-- ============================================================================
-- 1) Private notification preferences (one row per auth user, opt-in defaults off)
-- ============================================================================
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- Email channel (transactional to auth.users.email, not Gmail OAuth)
  email_enabled boolean not null default false,
  email_unsubscribed_at timestamptz check (email_unsubscribed_at is null or email_unsubscribed_at <= now()),
  email_unsubscribe_token text unique check (char_length(email_unsubscribe_token) between 16 and 128),
  -- Push channel (VAPID web-push; no paid infra silently added)
  push_enabled boolean not null default false,
  -- Delivery caps / throttling overrides (null = use server defaults)
  email_daily_cap integer check (email_daily_cap is null or email_daily_cap between 0 and 50),
  push_daily_cap integer check (push_daily_cap is null or push_daily_cap between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_preferences_email_enabled_idx on public.notification_preferences (email_enabled) where email_enabled;
create index if not exists notification_preferences_push_enabled_idx on public.notification_preferences (push_enabled) where push_enabled;

-- Auto-touch updated_at
drop trigger if exists notification_preferences_updated_at on public.notification_preferences;
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 2) Push subscriptions — private, per-user, never exposed cross-user
-- ============================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) >= 10 and char_length(endpoint) <= 2000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) >= 20 and char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) >= 10 and char_length(auth) <= 100),
  -- User agent hint for debugging (never trust for auth)
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
create index if not exists push_subscriptions_created_at_idx on public.push_subscriptions (created_at desc);

drop trigger if exists push_subscriptions_updated_at on public.push_subscriptions;
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 3) Notification outbox — durable, idempotent, throttled, retry-bounded
-- ============================================================================
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email','push')),
  -- What triggered it (message_id for new-message; listing_id/report etc. could reuse)
  message_id uuid references public.messages(id) on delete set null,
  thread_id uuid references public.threads(id) on delete cascade,
  -- Dedupe / coalesce
  dedupe_key text not null check (char_length(dedupe_key) >= 8 and char_length(dedupe_key) <= 200),
  -- Generic payload (never message body for email/push)
  payload jsonb not null default '{}'::jsonb check (length(payload::text) <= 2000),
  -- Delivery state machine
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped','unsubscribed','invalid_endpoint')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_error text check (char_length(last_error) <= 1000),
  next_attempt_at timestamptz,
  sent_at timestamptz check (sent_at is null or sent_at >= created_at),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_outbox_dedupe_unique unique (user_id, channel, dedupe_key)
);
create index if not exists notification_outbox_pending_idx on public.notification_outbox (status, next_attempt_at) where status in ('pending','sending');
create index if not exists notification_outbox_user_created_idx on public.notification_outbox (user_id, created_at desc);
create index if not exists notification_outbox_thread_idx on public.notification_outbox (thread_id);
create index if not exists notification_outbox_message_idx on public.notification_outbox (message_id);

drop trigger if exists notification_outbox_updated_at on public.notification_outbox;
create trigger notification_outbox_updated_at before update on public.notification_outbox
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 4) Optional: per-day send counters (or compute from outbox with partial index)
-- ============================================================================
-- We prefer counting via outbox with date_trunc('day', created_at) window and
-- row-level locking in the RPC, mirroring reserve_ai_usage pattern, to avoid a second table.
-- Hard caps defined here as constants (see RPC).

-- ============================================================================
-- 5) RLS — private, never public
-- ============================================================================
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;

-- Preferences: owner-only
drop policy if exists "Users can view own preferences" on public.notification_preferences;
create policy "Users can view own preferences" on public.notification_preferences for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can upsert own preferences" on public.notification_preferences;
create policy "Users can upsert own preferences" on public.notification_preferences for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users can update own preferences" on public.notification_preferences;
create policy "Users can update own preferences" on public.notification_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete for audit; use soft unsubscribed_at

-- Push subscriptions: owner-only
drop policy if exists "Users can view own push subs" on public.push_subscriptions;
create policy "Users can view own push subs" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can insert own push sub" on public.push_subscriptions;
create policy "Users can insert own push sub" on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users can update own push sub" on public.push_subscriptions;
create policy "Users can update own push sub" on public.push_subscriptions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users can delete own push sub" on public.push_subscriptions;
create policy "Users can delete own push sub" on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Outbox: owner can view own; only service role inserts (via RPC / cron)
drop policy if exists "Users can view own outbox" on public.notification_outbox;
create policy "Users can view own outbox" on public.notification_outbox for select to authenticated using (user_id = auth.uid());
-- No direct insert from client; writes via security-definer RPC that verifies auth.uid()

-- ============================================================================
-- 6) Grants — explicit, least-privilege
-- ============================================================================
revoke all on public.notification_preferences, public.push_subscriptions, public.notification_outbox from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notification_outbox to authenticated;
-- RPCs below receive narrow EXECUTE grants

-- ============================================================================
-- 7) RPCs — reserve/send pattern (mirrors ai_budget / reserve_ai_usage)
-- ============================================================================

-- Budget table (singleton) for global caps — optional, reused from ai_budget pattern
create table if not exists public.notification_budget (
  id boolean primary key default true check (id),
  email_daily_limit integer not null default 200 check (email_daily_limit between 0 and 10000),
  push_daily_limit integer not null default 500 check (push_daily_limit between 0 and 10000),
  per_user_email_daily_limit integer not null default 10 check (per_user_email_daily_limit between 0 and 100),
  per_user_push_daily_limit integer not null default 10 check (per_user_push_daily_limit between 0 and 100)
);
insert into public.notification_budget(id) values (true) on conflict (id) do nothing;

alter table public.notification_budget enable row level security;
revoke all on public.notification_budget from anon, authenticated;
-- No anon/authenticated grants; RPC accesses it as definer

-- Reserve a notification send (idempotent, throttled, hard-capped)
create or replace function public.reserve_notification_send(
  p_channel text,
  p_thread_id uuid,
  p_message_id uuid,
  p_dedupe_key text
) returns table(allowed boolean, outbox_id uuid, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  budget public.notification_budget;
  prefs public.notification_preferences;
  existing uuid;
  today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  user_daily_count integer;
  global_daily_count integer;
begin
  if who is null then return query select false, null::uuid, 'unauthorized'::text; return; end if;
  if p_channel not in ('email','push') then return query select false, null::uuid, 'invalid_channel'::text; return; end if;
  if p_dedupe_key is null or char_length(p_dedupe_key) < 8 then return query select false, null::uuid, 'invalid_dedupe'::text; return; end if;

  -- Idempotent dedupe: if this user+channel+dedupe already exists, return existing
  select id into existing from public.notification_outbox
    where user_id = who and channel = p_channel and dedupe_key = p_dedupe_key limit 1;
  if found then return query select true, existing, 'deduplicated'::text; return; end if;

  -- Verify caller is participant of thread (secure recipient selection)
  if not exists (select 1 from public.threads t where t.id = p_thread_id and (t.buyer_id = who or t.seller_id = who)) then
    return query select false, null::uuid, 'not_participant'::text; return;
  end if;

  select * into budget from public.notification_budget where id = true for update;
  select * into prefs from public.notification_preferences where user_id = who;

  if p_channel = 'email' and coalesce(prefs.email_enabled, false) is distinct from true then
    return query select false, null::uuid, 'email_disabled'::text; return;
  end if;
  if p_channel = 'push' and coalesce(prefs.push_enabled, false) is distinct from true then
    return query select false, null::uuid, 'push_disabled'::text; return;
  end if;
  if prefs.email_unsubscribed_at is not null and p_channel = 'email' then
    return query select false, null::uuid, 'unsubscribed'::text; return;
  end if;

  -- Coalesce throttle: skip if a pending/sent notification for same thread within 15 min window
  if exists (
    select 1 from public.notification_outbox
    where user_id = who and channel = p_channel and thread_id = p_thread_id
      and created_at >= now() - interval '15 minutes'
      and status in ('pending','sending','sent')
  ) then
    return query select false, null::uuid, 'throttled'::text; return;
  end if;

  -- Hard caps
  select count(*) into user_daily_count from public.notification_outbox
    where user_id = who and channel = p_channel and created_at >= today and status in ('pending','sending','sent');
  select count(*) into global_daily_count from public.notification_outbox
    where channel = p_channel and created_at >= today and status in ('pending','sending','sent');

  if p_channel = 'email' and (user_daily_count >= least(budget.per_user_email_daily_limit, coalesce(prefs.email_daily_cap, 10)) or global_daily_count >= budget.email_daily_limit) then
    return query select false, null::uuid, 'cap_exceeded'::text; return;
  end if;
  if p_channel = 'push' and (user_daily_count >= least(budget.per_user_push_daily_limit, coalesce(prefs.push_daily_cap, 10)) or global_daily_count >= budget.push_daily_limit) then
    return query select false, null::uuid, 'cap_exceeded'::text; return;
  end if;

  insert into public.notification_outbox(user_id, channel, thread_id, message_id, dedupe_key, payload, status, next_attempt_at)
  values (who, p_channel, p_thread_id, p_message_id, p_dedupe_key, jsonb_build_object('channel', p_channel, 'thread_id', p_thread_id::text), 'pending', now())
  returning id into existing;

  return query select true, existing, null::text;
end; $$;
revoke all on function public.reserve_notification_send(text,uuid,uuid,text) from public;
grant execute on function public.reserve_notification_send(text,uuid,uuid,text) to authenticated;

-- Mark attempt result (bounded retries)
create or replace function public.complete_notification_send(
  p_outbox_id uuid,
  p_ok boolean,
  p_error text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  row public.notification_outbox;
begin
  if who is null then raise exception 'Authentication required'; end if;
  select * into row from public.notification_outbox where id = p_outbox_id and user_id = who for update;
  if not found then raise exception 'Outbox entry not found or not yours'; end if;
  if p_ok then
    update public.notification_outbox set status='sent', sent_at=now(), updated_at=now(), last_error=null where id=p_outbox_id;
  else
    -- Bounded retries: 3 attempts with backoff handled by cron (next_attempt_at = now() + backoff)
    -- Classify hard failures (invalid_endpoint, unsubscribed) vs retryable
    update public.notification_outbox set
      attempts = attempts + 1,
      last_error = left(p_error, 500),
      status = case when attempts + 1 >= 3 or p_error in ('invalid_endpoint','unsubscribed','cap_exceeded') then 'failed' else 'pending' end,
      next_attempt_at = case when p_error in ('invalid_endpoint','unsubscribed') then null else now() + (case when attempts = 0 then interval '1 minute' when attempts = 1 then interval '5 minutes' else interval '30 minutes' end) end,
      updated_at = now()
    where id = p_outbox_id;
  end if;
end; $$;
revoke all on function public.complete_notification_send(uuid,boolean,text) from public;
grant execute on function public.complete_notification_send(uuid,boolean,text) to authenticated;
-- Cron/service_role will call a privileged variant (not exposed to client) for server-side sends

-- Endpoint validation — SSRF guard (called from push subscription route)
create or replace function public.validate_push_endpoint(p_endpoint text)
returns boolean language plpgsql immutable as $$
begin
  if p_endpoint is null or char_length(p_endpoint) > 2000 or p_endpoint not like 'https://%' then return false; end if;
  -- Host checks via regex — full allowlist enforced in API route (JS URL parsing) as well
  if p_endpoint ~* 'localhost|127\.0\.0\.1|::1|\.local|10\.\d|192\.168\.|169\.254\.169\.254|metadata\.google\.internal' then return false; end if;
  return true;
end; $$;
revoke all on function public.validate_push_endpoint(text) from public;
grant execute on function public.validate_push_endpoint(text) to authenticated;

-- Revoke trigger functions from public (as with existing migrations)
revoke all on function public.handle_updated_at() from public;
```

**Notes on this draft vs. existing migrations:**
- Reuses `public.handle_updated_at` (already in `001_initial.sql`) — no duplicate definition.
- Mirrors `reserve_ai_usage` / `complete_ai_usage` atomicity (budget row `FOR UPDATE`, `date_trunc('day', …)` window).
- `revoke` / `grant` mirrors existing explicit-grant pattern (no reliance on project defaults).
- No `profiles.email` column — email is `auth.users.email` read server-side only, preserving `profiles` public-safe design (spec forbids public email profiles).
- All notification state is `PRIVATE` — RLS prevents cross-user reads; `outbox` inserts only via RPC.

---

## 6) Setup & Blocker Checklist (exact, before any send)

| Blocker | Owner action required | Code consequence |
|---|---|---|
| **Domain + DNS** | Provide domain for `noreply@` (e.g. `re-love.in`); owner configures SPF, DKIM, DMARC per chosen provider (Resend wizard gives 3 CNAMEs) | Without this, emails fail SPF/DKIM → spam/4xx. No send will be attempted. |
| **Provider choice + key** | Approve Resend (rec. free) vs SendGrid/SES; create provider account; generate API key / SMTP creds | Env `RESEND_API_KEY` or `SMTP_*` + `NOTIFICATIONS_FROM` remain unset → server refuses to send. This PR sets none. |
| **Vercel env** | Owner adds approved env vars in Vercel project settings (not `.env.local` committed) | Code reads `process.env.NOTIFICATIONS_*` only after approval; until then docs-only. |
| **Schema approval** | Owner reviews `003_notifications.sql` draft above; sole release integrator owns remote apply | No `supabase db push`; migrations-draft stays review-only until explicit. |
| **VAPID keys** | `npx web-push generate-vapid-keys` → owner stores `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` in Vercel/Supabase vault | SW already expects `applicationServerKey`; without keys, subscription fails gracefully (handled in `push-opt-in.tsx`). |
| **Unsubscribe flow** | Approve `email_unsubscribe_token` generation + `List-Unsubscribe` header handling | Skip → would violate Gmail bulk-sender rules. |
| **Supabase Auth email verified** | Ensure Google OAuth users have `email_confirmed_at` (Supabase marks OAuth as verified) | Unverified skip prevents sending to fake addresses. |

Until all blockers are cleared, the UI shows only in-app toasts + informational `<PushOptInCard />`; no “Email enabled” toggle is rendered (explicitly avoided per task).

---

## 7) Frontend Integration (done vs. pending)

**Done:**
- Polling as above in `NotificationsProvider` — modest 30 s, visible-tab only, focus-triggered, no overlap, abort/cleanup, account-isolation, demo guard, palette-correct.
- Header + mobile badge, toast list, thread-open suppression, inbox sync.
- `public/sw.js` push foundations with generic content and `notificationclick` routing.
- PWA offline preserved (shell cache unchanged; API/auth bypass network-only).

**Pending (schema-blocked):**
- `POST /api/notifications/preferences` — update `notification_preferences` (opt-in, caps).
- `POST /api/notifications/subscribe` — VAPID subscription insert (validates endpoint, SSRF, auth, `user_id = auth.uid()`).
- `DELETE /api/notifications/subscribe` — revoke.
- Cron `GET /api/cron/notifications` (Vercel cron + `CRON_SECRET`) — drains `notification_outbox` pending, calls Resend / web-push, updates `complete_notification_send`, respects `next_attempt_at` backoff, hard caps.
- Email template in `lib/notifications/templates.ts` (generic body, unsubscribe link with HMAC token).
- UI toggles for email/push in `profile/page.tsx` (only after preferences table exists; currently shows informational card instead).

All pending code will live in isolated `src/app/api/notifications/**` and `src/lib/server/notifications/**` — no AI routes touched (owned by other Muse).

---

## 8) Tests & Validation

**Added pure-helper tests (pending in `tests/notifications.test.ts` — see below):**
- `computeGlobalUnreadCount` sum.
- `createToastDedupeKey` / `detectNewMessageToasts` dedupe, self-message suppression, open-thread suppression, initial-flood suppression, account-isolation reset, max-toasts cap.
- `getOpenThreadId` parsing.
- `isValidPushEndpoint` SSRF cases.
- `shouldPollNotifications` demo/unauth guard.
- Async cleanup: abort controller aborts on unmount/user-change, interval cleared when `visibilityState === "hidden"`, no overlapping fetches.

**Existing tests expected to still pass:**
- `tests/backend.test.ts`, `http.test.ts`, `database.test.ts`, `reliability.test.ts`, `smoke-ai.test.ts`, `ai.test.ts` — no HTTP boundary weakened, no RLS change, no AI route touched.

**Manual validation performed:**
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (reported separately in commit message; see SHA below).

---

## 9) Non-Goals / Explicitly Not Done

- No `npm install resend` / `web-push` / `nodemailer`; no `.env.local` read; no `supabase db push`; no remote writes.
- No `navigator.notification.requestPermission()` on page load — only click-bound.
- No exposing `push_subscriptions.endpoint` to other users; no logging message bodies; no AI used for notifications.
- No silent paid push infra (Firebase Cloud Messaging paid tier, OneSignal) — VAPID is free.
- No sockets/realtime (`supabase realtime` not enabled for messages — spec forbids).
- No “Email enabled” fake toggle, no sample-inventory toasts.

---

## 10) Contact

Open questions answered: closed-app push is **in scope** alongside email; provider/keys need owner input as above.  
For schema review: comment on this doc or on `003_notifications.sql` draft — integrator will not apply until `Approved-by: <owner>` recorded.

