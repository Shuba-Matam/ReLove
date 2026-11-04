# Release validation — Re-Love

This doc describes the exact commands, phases, modes, and remaining manual steps. No secrets are printed by any script.

## Combined integration — November 3, 2026

The black-base UI, Phase 2 AI hardening and recovered reliability fixes are integrated. `npm run check` passed: 85 app tests, 27 release tests, lint, type checking and production build. The local production build passed `smoke-http --start --expect=live` against the existing database, using read-only requests; its temporary server exited cleanly. AI remains disabled pending application keys and provider smoke tests. No new real-account sign-in or visual browser verification is claimed by these checks.

## Status recorded November 2, 2026

The marketplace is integrated and deployed by the primary coordinating thread. The migration application is recorded in `supabase/migrations-draft/README.md`; do not reapply it as an onboarding step. The owner reported successful Google login, posting, and messaging tests on November 2. Further live regression checks belong to the primary release workflow.

This continuation adds backend reliability fixes and release validation without requiring provider credentials. It preserves the current API contracts and schema. AI provider enablement and the parallel UI work remain with the primary thread.

## Exact env contract (final builder commit — already set in Vercel/local)

```
APP_MODE=live                # demo for public CI smoke; setup code remains in src/lib/server/env.ts
SUPABASE_URL                 # required in live, https (localhost http exception)
SUPABASE_PUBLISHABLE_KEY     # required in live (SUPABASE_ANON_KEY fallback supported)
GOOGLE_AUTH_ENABLED=true     # live already true (demo=false for CI)
AI_ENABLED=false             # release AI off; provider keys optional
BASETEN_API_KEY              # optional, draft/moderation
BASETEN_MODEL=meta-models/muse-spark-open-1026  # optional default
META_API_KEY                 # optional, transcribe/cutout
AI_DAILY_LIMIT=60            # optional 0..1000; shared cap across accounts
AI_USER_DAILY_LIMIT=20       # optional 0..1000; ordinary authenticated account
AI_OWNER_DAILY_LIMIT=50      # optional 1..1000; allowlisted owner only, falls back to user limit when unset
AI_TEST_MODE=false           # all authenticated accounts; allowlist still classifies the owner cap
AI_MAX_RETRIES=0             # no provider retry during activation
VAPID_SUBJECT=mailto:...     # operator contact URI
VAPID_PUBLIC_KEY=...         # public half of one web-push keypair
VAPID_PRIVATE_KEY=...        # server-only
PUSH_DRAIN_SECRET=...        # scheduled recovery drain bearer secret
```

Before enabling push, review and apply `supabase/migrations-draft/005_messaging_notifications.sql`, confirm `public.messages` is in `supabase_realtime`, and schedule a minutely authenticated POST to `/api/push/drain`. Immediate delivery also runs after the message response using Next `after()`, but retries depend on the scheduled drain. Test Chrome/Edge desktop and Android, Firefox, Safari, and an iOS/iPadOS 16.4+ Home Screen installation with two real accounts. Verify account switch and logout do not retain the prior account's subscription.

`AI_OWNER_DAILY_LIMIT` is selected only from the verified server-side user email/ID in `AI_OWNER_ALLOWLIST`; request input cannot raise it. The owner override applies whether or not `AI_TEST_MODE` is enabled. If the override is present but invalid, allowlisted owner requests fail closed; ordinary authenticated users continue to use `AI_USER_DAILY_LIMIT`.

Production uses the configured limits of 60 shared, 20 per ordinary authenticated account, and 50 for the allowlisted owner. If `AI_USER_DAILY_LIMIT` is unset, the source fallback remains 15.

`setup` paths remain in code but deploy target is `live` (healthy 200) vs `demo` (honest samples). See **Mode semantics**.

## Phases — what to run (copy-paste)

All env is loaded via Node's built-in flags — no custom dotenv parser.

```sh
# 0. Use Node 22.14+ (engines >=22.14.0 <25)
node --version

# 1. Env sanity — demo must pass with no env
node scripts/check-env.mjs
# or with local file
node --env-file-if-exists=.env.local scripts/check-env.mjs
# JSON for automation
node scripts/check-env.mjs --json
# Live check (requires SUPABASE_URL+publishable key)
node --env-file=.env.local scripts/check-env.mjs --strict

# 2. Install (bypass npm10 edgesOut bug — use npm 11.21.1)
npx --yes npm@11.21.1 ci

# 3. Lint / typegen / tests — in CI order
npx --yes npm@11.21.1 run lint
npx --yes npm@11.21.1 run typecheck   # next typegen && tsc --noEmit (clean-checkout fix)
npx --yes npm@11.21.1 test            # app tests (vitest)
npx --yes npm@11.21.1 run test:release # built-in release script tests, no deps (also in npm run check)
# or directly: node --test scripts/release-checks.test.mjs

# 4. Production build — demo, AI off, no secrets (CI does this)
APP_MODE=demo AI_ENABLED=false GOOGLE_AUTH_ENABLED=false npx --yes npm@11.21.1 run build

# 5. HTTP smoke — existing origin
node scripts/smoke-http.mjs --expect=demo
npx --yes npm@11.21.1 run smoke:http -- --expect=demo --origin=http://localhost:3000
node scripts/smoke-http.mjs --expect=live --origin=https://re-love-pi.vercel.app

# 6. HTTP smoke — auto-start production server on free port, always cleans up
node scripts/smoke-http.mjs --start --expect=demo
npx --yes npm@11.21.1 run smoke:http -- --start --expect=demo --port=3100 --timeout=8000
```

On Windows PowerShell, use `node scripts/smoke-http.mjs --start --expect=demo` directly if an npm wrapper drops the forwarded flags. To force a demo build, set `$env:APP_MODE='demo'`, `$env:AI_ENABLED='false'`, and `$env:GOOGLE_AUTH_ENABLED='false'` before the build command.

## Mode semantics (what the smoke distinguishes)

* **demo (200)** — explicit honest sample listings from `src/lib/demo.ts` (original local SVGs `/demo/*.svg`), `description` contains *illustrative sample*, `mode:"demo"` in `{data,mode,meta}` envelope, `/api/my-listings` 401 and mutations 403, inbox empty. Never silently turns live DB failures into samples.
* **setup / unready (503)** — `GET /api/health` → `503 {data:{status:"unavailable",reason:"missing_config"|"schema_unavailable",mode},mode:"setup"}` and `GET /api/listings` → 503 `SETUP_REQUIRED`. Demo smoke must not claim live readiness; live smoke must not pass when mode is setup/demo.
* **live healthy (200)** — `GET /api/health` → `200 {data:{status:"ok",mode:"live"},mode:"live"}`, `GET /api/categories` + `/api/listings?category=furniture&q=seat` return real DB rows with `mode:"live"` and `meta.next_cursor`, sample marker absent. Unauthenticated private APIs → 401 (demo may also be 403 per `src/lib/server/auth.ts`), never 200 with data leak.

All API/ private responses are `Cache-Control: private, no-store` — smoke checks this. PWA `public/sw.js` is `no-cache`, network-only for `/api/` and `/auth/`, `offline.html` excluded from auth/API caching.

## Callback routes (no additional plumbing needed)

* Local: `http://localhost:3000/auth/callback` (and `/auth/login?next=/sell`)
* Production: `https://re-love-pi.vercel.app/auth/callback`
* Google → Supabase: Supabase project `/auth/v1/callback` (client credentials remain in hosted Supabase Auth, never `NEXT_PUBLIC`)

Both domains are already in Supabase site URL / redirect allowlist per `re-love-pi.vercel.app`.

## What is NOT done here (sidecar scope only)

* This continuation prepares commits for the primary thread to integrate. It does not apply schema changes, push, or deploy. The owner-approved SQL has already been applied according to the migration record.
* CI builds demo with `APP_MODE=demo AI_ENABLED=false GOOGLE_AUTH_ENABLED=false` and no secrets for public smoke; production runtime is already `APP_MODE=live GOOGLE_AUTH_ENABLED=true AI_ENABLED=false` in Vercel and local `.env.local`.
* No paid AI calls; smoke never sends provider credentials. AI routes stay 503 disabled until owner later enables with `BASETEN_API_KEY`/`META_API_KEY`.

## Remaining verification (outside this checkout)

1. **Integration** — primary thread integrates the reliability commits with the parallel AI/UI work, then runs the release checks on the combined result.
2. **Live regression** — the owner reported login, posting, and messaging working. After integration, verify these on the connected deployment; this local test pass does not establish new real-account evidence.
3. **Live smoke** — `node --env-file=.env.local scripts/check-env.mjs --strict` and `node scripts/smoke-http.mjs --expect=live --origin=https://re-love-pi.vercel.app` through the primary release workflow.
4. **Optional AI** — if enabling later, set `AI_ENABLED=true` plus at least one provider key and non-zero caps; DB `ai_budget`/`ai_settings` remain hard upper caps.

No further owner approvals needed — this doc does not re-ask for decisions already made.

## Changed paths (this release layer only)

* `scripts/check-env.mjs` — robust ESM CLI, server-only credential checks, localhost https exception, zero-cap allowed, service_role misuse rejected, `NEXT_PUBLIC_*` forbidden, repo-leak warning, never prints secrets. **Not modified in this patch — owned by primary thread.**
* `scripts/smoke-http.mjs` — ESM fetch-only GETs, manual redirect/same-origin, bounded bodies/timeouts, `--expect` mode contract, HTML + health/session/categories/listings/pagination/detail/private-API/PWA/no-store checks, `--start` spawns production Next on free port and always cleans up. This patch adds bounded 5s hard cleanup and Windows `taskkill /T /F` tree-kill.
* `scripts/release-checks.test.mjs` — `node:test` built-in tests with isolated env (no host secret bleed), real behavioral smoke against stub origins (pass/fail on mode/health/redirect), bounded subprocess timeouts and Windows cleanup; run via `npm run test:release` or `node --test`.
* `package.json` — adds `test:release` (`node --test scripts/release-checks.test.mjs`) and `smoke:http` (`node scripts/smoke-http.mjs`); `check` now runs `lint && typecheck && test && test:release && build`.
* `.github/workflows/ci.yml` — least-privilege `contents:read`, PR+push `main`, concurrency cancel, Node 22.14, `npx --yes npm@11.21.1 ci`, lint → typecheck (next typegen before tsc) → tests → `node --test` release checks → demo build (no secrets) → `--start` demo smoke. **Not modified here — primary thread owns CI.**
* `docs/RELEASE.md` — this file (documents new scripts, preserves primary ownership of release/deployment).

## Tests run locally

```
node scripts/check-env.mjs --help                          # 0
node scripts/check-env.mjs                                 # 0 (demo, no env)
node --env-file-if-exists=.env.local scripts/check-env.mjs # 0
npx --yes npm@11.21.1 ci                                   # ok
npx --yes npm@11.21.1 run lint                             # ok
npx --yes npm@11.21.1 run typecheck                        # ok
npx --yes npm@11.21.1 test                                  # 73 passed (November 2 continuation)
npx --yes npm@11.21.1 run test:release                      # passed (release layer, isolated, behavioral)
node --test scripts/release-checks.test.mjs               # alias, same
APP_MODE=demo AI_ENABLED=false GOOGLE_AUTH_ENABLED=false npx --yes npm@11.21.1 run build  # ok demo build
npx --yes npm@11.21.1 run smoke:http -- --start --expect=demo  # 0 (demo HTTP smoke, bounded cleanup)
npx --yes npm@11.21.1 run check                            # lint + typecheck + test + test:release + build
```

## Remaining limits / integration note

* The November 2 continuation in `t3/279214cf` passed `npm run check` (73 app tests, 27 release tests, lint, typecheck, production build) and `node scripts/smoke-http.mjs --start --expect=demo`. The smoke server exited successfully. No new browser, real-account, provider, or deployment verification is claimed here.
* Live feed failures return `503 DATABASE_UNAVAILABLE`; only `PGRST103` range errors trigger a bounded count recovery using the same filters. Category database failures also return 503 instead of an invalid-category response. Message inserts rely on the existing `messages_bump_thread` database trigger, removing a redundant network update; the real migration test verifies inbox ordering.
* `next typegen` before `tsc` required on clean checkouts (`.next/types` generation) — CI encodes this.
* `npm ci` via `npx --yes npm@11.21.1 ci` avoids the npm10 `edgesOut` bug.
* Contract verified against `src/lib/server/env.ts`, `src/lib/ai/context.ts`, `src/app/api/health/route.ts`, `src/lib/server/queries.ts`, `supabase/migrations-draft/001_initial.sql` + `002_ai.sql` — no mismatch; future `ApiResponse {data,mode,meta}` / health `setup503` drift will fail smoke.
