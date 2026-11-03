# Re-Love Notifications — Proposal & Implementation Status

> ⚠️ **NOT APPROVAL READY — DURABLE EMAIL/PUSH CANDIDATE UNSAFE (DO NOT APPLY)**
> `docs/drafts/004_notifications.sql` has known defects, docs-only, never remote-apply. See §5 for defect list. No worker, no sends, no env/keys.

**Status:** In-app toasts shipped (summary polling, bounded, identity-gated). Durable push/email **NOT READY** — candidate blocked. No external sends, no provider setup, no env reads.

**Main branch:** `77c9e3b` — `t3/message-toasts-email-proposal` (this worktree).  
**User requests:** message pop-ups + email notifications + closed-app push. Subagents do code, not Astra. `AGENTS.md` read. Next may be custom — verified `src/lib/server/*` contracts before writing code.

---

## 1) Goals & Hard Constraints (from user)

- Preserve existing inbox/thread behaviour: window-focus refresh with unread counts; **no realtime sockets**. Keep that.
- **Implemented now:** accessible in-app new-message toast + global unread indicator while app is open using modest visible-tab polling (30 s, 10 s timeout), focus refresh, no overlapping requests (generation fencing), coalesced refresh, dedupe by stable message UUID, bounded 200 seen history, abort/timeout cleanup, user-account change isolation with identity-gated state (no old-data flash), don’t toast self/already-open-read or flood initial history. Polling uses `GET /api/notifications/summary` — authenticated `private, no-store`, fixed 3 queries (exact head count + bounded 20 latest unread IDs + batched thread metadata), **no per-thread N+1** (replaces prior `GET /api/threads` 2N+1 up to 201 queries). Validated with Zod, no message bodies. **No weakening RLS / no-store**; **no AI**; paid Vercel not required. Toast clickable, dismissible, `aria-live` appropriate, black-dominant palette `#020102 / #01071d / #021640 / #03245e / #220815, #F5F5F7, #9AA4B8` + light blue `#82b7ff / #93c5fd / #60a5fa`.
- **Not done:** no inventing toasts on sample/demo inventory; no sockets.
- **Clarification resolved:** user confirmed closed-app push **in addition** to in-app + opt-in email. Push shows concise “coming soon” until schema approved — no permission prompt, no fake “enabled”. Durable push/email delivery needs candidate `docs/drafts/004_notifications.sql` approval before applying.
- **Email:** transactional email to the user’s Google address (from Supabase `auth.users.email`), **not** Gmail account read/send OAuth scope. Generic private copy **without message bodies**. User opt-in/unsubscribe, idempotent throttled delivery, bounded retries, hard send cap, secure recipient selection. No sending, no provider setup, no extra deps, no env reads/remote writes, no email to real users — docs/schema candidate only until approved and until owner provides verified sender domain. Free Vercel has no custom domain, so Resend/SMTP remains blocked; optional provider setup explained without requiring purchases (see §6).
- **Push (closed-app):** prefer VAPID web-push (viable free), never silently add paid infra. Never expose endpoints/keys to other users; validate endpoints/SSRF; verify authorized recipients; generic content; bounded retries/send caps/unsubscribe; clear delivery failure states. No Meta/AI used for notifications. Preserve existing PWA offline behaviour (`public/sw.js` shell cache + `/offline.html`).
- Tests meaningful for account isolation/dedupe/cleanup; lint/typecheck/build must pass without weakened checks.

---

## 2) What Is Implemented Now (frontend in-app — no schema change)

**Files added/updated:**
- `src/lib/notifications.ts` — helpers: `computeGlobalUnreadCount`, `detectNewMessageToasts`, `parseNotificationSummary` (Zod), `isValidPushEndpoint` (exact allowlist, https 443/no creds/no fragment), `pruneSeenHistory`, `coerceNotificationToastFromMessage`, constants `POLL 30s / TIMEOUT 10s / TOAST 8s / MAX 3 / SEEN 200`.
- `src/lib/client/notifications.tsx` — `NotificationsProvider` with generation/identity fencing (discard after every await), timeout abort, no-overlap guard with fence, coalesced refresh, identity-gated state (no old-data flash), A→B restart lifecycle (effect depends on userId), visible-tab pause/resume, demo guard, stable UUID dedupe, open-thread suppression, bounded history, initial baseline suppression.
- `src/app/api/notifications/summary/route.ts` — authenticated `GET` returning `{ unreadCount: number, messages: {id, threadId, createdAt, listingTitle, listingImageUrl, participantName}[] }` — fixed 3 queries (head count + 20 latest unread + batched threads), RLS-only, no bodies, Zod-validated, `private, no-store`.
- `src/lib/client/push.ts` — support detection only (no permission prompt until backend ready).
- `src/components/notifications/unread-badge.tsx`, `notification-toast.tsx`, `notification-toasts.tsx`, `push-opt-in.tsx` — toast list (`aria-live="polite"`), auto-close 8 s pause, black palette + light-blue, badge on header/mobile nav; PushOptInCard is static “coming soon” (no hydration mismatch, no permission button, no fake enabled).
- `public/sw.js` — fixed generic title/body, UUID-validated threadId, same-origin navigation with await navigate, tag per thread, shell-cache preserved.
- `src/app/layout.tsx` — wraps `SessionProvider` with `NotificationsProvider` + mounts `<NotificationToasts />` once.
- `src/components/layout/site-header.tsx`, `mobile-nav.tsx` — unread badge with `aria-label` counts; `Mail` icon remains 18 px.
- `src/app/inbox/page.tsx`, `src/app/inbox/[id]/page.tsx` — keep focus refresh, call `refreshNotifications()` after load/mark-read to keep global badge in sync; thread suppresses toast for its own `openThreadId`.
- `src/app/profile/page.tsx` — embeds `<PushOptInCard />` with verified support messaging; no auto-permission, no fake enabled state.

**Behaviour:**
- Poll `GET /api/notifications/summary` (`private, no-store`, RLS) every 30 s only when visible and live+authed. 10 s timeout aborts stale request. Paused when hidden; immediate re-fetch on focus/visible.
- No overlapping: generation counter + `fetchingGenerationRef` fence; coalesced `refresh()` dedupes concurrent calls; old finally cannot clear newer lock; request identity captured and discarded after every await including JSON.
- Stable ID dedupe: message UUID only (not composite), `seenKeys` bounded 200 with prune; open-thread suppression; initial baseline seeds seen without toasts.
- Demo never polls; account isolation clears state, bumps generation, aborts, clears interval and restarts lifecycle per userId (dependency includes identity) with identity-gated rendered state preventing old-data flash.

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

**Behaviour after approval (candidate `docs/drafts/004_notifications.sql`, DEFAULT DISABLED):**
- Trigger `messages → enqueue_notification_from_message()` derives `recipient_id = NEW.recipient_id` (trusted, not sender `auth.uid()`), honors `email_enabled`/`push_enabled` + unsubscribe + per-user/global daily caps (incl failures), coalesce 15m throttle, idempotent `dedupe_key` unique.
- Validate recipient email verified; skip unverified. Generic content only; never log body. No email to real users until domain verified.
- Worker-only `claim_notifications(p_limit,p_owner)` with `FOR UPDATE SKIP LOCKED` + lease fencing (`lease_owner`, `lease_expires_at`); `reap_stale_notification_leases()`; retry caps via `budget.max_attempts` (≤5) with backoff 1m/5m/30m; opt-out recheck at claim/complete; per-device push rows via `push_subscription_id`.
- Honest limits: at-least-once — worker crash after provider send but before `complete_notification_send()` may duplicate; dedupe_key mitigates queue dupes but provider idempotency not guaranteed; `List-Unsubscribe` header + token; retries `no-store` server-only.

**Explicit non-goals in this PR:** no `fetch` to provider, no `nodemailer`/`resend` dep added, no env read, no remote DB write.

---

## 4) Closed-App Push — Foundations & Verified Browser Guidance

**Preference:** VAPID web-push (free, no third-party push service). Payload encrypted client-side via `applicationServerKey` (VAPID public key); server sends via `web-push` library or `fetch` to endpoint with `VAPID` JWT — no Firebase/OneSignal paid tier unless owner later chooses.

**Verified support matrix (tested in `getPushSupport()` and `public/sw.js`):**

- Requires **HTTPS** (`isSecureContext`). `http://localhost` works for dev; prod Vercel `https://re-love-pi.vercel.app` qualifies.
- **Service Worker** (`navigator.serviceWorker`) + **PushManager** (`window.PushManager`) + **Notification** (`window.Notification`). Chrome/Edge/Firefox desktop + Android Chrome pass. iOS Safari 16.4+ partially supports web-push **only when app is added to Home Screen (PWA installed)**; iOS 17+ expands but still needs user gesture. Desktop Safari has push but with limitations.
- `public/sw.js` already registered in `pwa-registration.tsx` (secure-context guard). Push handlers added non-intrusively; existing `fetch` shell-cache (`CACHE = "relove-shell-v1"`) preserved — no offline regression.
- **No auto-prompt / no fake enabled:** Push UI is static “coming soon” — no `Notification.requestPermission()` until owner-approved backend and schema exist. In-app toasts already work; no permission is requested now. Browser permission states are documented but not exposed as enabled.

**Security / privacy (server-enforced after schema approval):**

- Never expose `endpoint`, `p256dh`, `auth` to other users. `push_subscriptions` RLS: user can only select/insert/delete own rows; no cross-user read.
- **SSRF validation:** endpoint must be `https:` only, default 443, no credentials/fragment, length ≤2000, exact host allowlist `fcm.googleapis.com`, `android.googleapis.com`, `updates.push.services.mozilla.com`, `push.services.mozilla.com`, `web.push.apple.com`, `api.push.apple.com` — checked server-side with `URL` parsing plus `redirect:error` and final-destination enforcement on sender.
- Verify authorized recipient: `push_subscriptions.user_id = auth.uid()` and subscription was created by that user via `VAPID` `applicationServerKey`; server never trusts endpoint supplied by other user.
- Generic notification content only (title `New message on Re-Love`, body as above, never message body). Click routes to `/inbox/:id` (no payload leakage).
- Bounded retries / send caps / unsubscribe:
  - Per-subscription `failure_count` increments on `410 Gone` / `404 NotRegistered` (endpoint expired) → auto-mark `invalid` and stop retrying; UI prompts re-subscribe.
  - Per-user caps: ≤ 10 pushes/day, ≤ 1 per thread per 15 min coalesced (same as email). Hard cap via RPC.
  - Retry `429` with `Retry-After` header; exponential backoff 1m/5m/30m ≤ 3 attempts.
  - Unsubscribe: user can remove subscription via UI (`DELETE /api/notifications/subscribe`) or browser site settings; server marks `revoked_at`.
- Clear delivery failure states: `pending` → `sent`/`failed` (transient) vs `invalid_endpoint`/`expired` vs `permission_revoked` (distinguished by HTTP status codes from push service). Logs never store `auth` secret.

**Still pending owner approval (no durable storage yet):** VAPID keypair is free and needs no paid Vercel; generation (`npx web-push generate-vapid-keys`) plus `docs/drafts/004_notifications.sql` tables below. No `web-push` dep added; SW uses fixed generic title/body and tolerates missing subscription. Email stays disabled pending verified sender/domain.

---

## 5) Schema Candidate — `docs/drafts/004_notifications.sql` — **NOT APPROVAL READY, DO NOT APPLY**

> **Known UNSAFE defects — must not be built now:**
> - Attempts increment only on `complete_notification_send(..., ok=false)` not on pre-send claim; crashed leases can retry unlimited without counting.
> - Caps count `notification_outbox` rows per day, not provider attempts — not true send caps.
> - Opt-out checked only at enqueue + `complete`, not at `claim`/pre-send — delivery may occur after unsubscribe.
> - `unique(user,endpoint)` allows shared-device cross-account leakage; logout does not revoke subscriptions.
> - Generic provider `Idempotency-Key` claim not verified against provider behavior.

**All tables PRIVATE; candidate docs-only, never apply. Location: `docs/drafts/004_notifications.sql`.**

---

## 6) Setup & Blocker Checklist (exact, before any send)

| Blocker | Owner action required | Code consequence |
|---|---|---|
| **Domain + DNS** | Provide domain for `noreply@` (e.g. `re-love.in`); owner configures SPF, DKIM, DMARC per chosen provider (Resend wizard gives 3 CNAMEs) | Without this, emails fail SPF/DKIM → spam/4xx. No send will be attempted. |
| **Provider choice + key** | Approve Resend (rec. free) vs SendGrid/SES; create provider account; generate API key / SMTP creds | Env `RESEND_API_KEY` or `SMTP_*` + `NOTIFICATIONS_FROM` remain unset → server refuses to send. This PR sets none. |
| **Vercel env** | Owner adds approved env vars in Vercel project settings (not `.env.local` committed) | Code reads `process.env.NOTIFICATIONS_*` only after approval; until then docs-only. |
| **Schema approval** | Owner reviews `docs/drafts/004_notifications.sql` candidate (DEFAULT DISABLED); sole release integrator owns remote apply | No `supabase db push`; candidate stays review-only until `Approved-by: <owner>`. |
| **VAPID keys (free, no paid Vercel)** | `npx web-push generate-vapid-keys` → store `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`+`VAPID_SUBJECT` in Vercel env when approved | With no keys, push stays `coming soon`; no paid Vercel domain needed for VAPID. |
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

**Added tests in `tests/notifications.test.ts` + `tests/notifications.lifecycle.test.ts`:**
- `parseNotificationSummary` Zod validation + `isValidPushEndpoint` strict allowlist (IPv6/userinfo/ports/https/fragment).
- `pruneSeenHistory` bounded 200, coalesced refresh, `coerceNotificationToastFromMessage` open-thread suppression.
- Generation/identity fencing, A→B restart lifecycle, old-data flash gated, timeout, no-overlap fencing (real provider logic, not simulated locals).
- Summary endpoint: fixed 3 queries, no per-thread N+1, error handling, demo mode.
- Candidate schema via PGlite: recipient-derived queue, opt-out, dedupe, caps (incl failures), lease fencing, worker-only privilege.

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
For schema review: comment on `docs/drafts/004_notifications.sql` — integrator will not apply until `Approved-by: <owner>` recorded. Email/push not sent to real users until test recipient route configured; email stays disabled without verified sender/domain.

