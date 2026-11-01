# Release validation — Re-Love

This doc describes the exact commands, phases, modes, and remaining manual steps. No secrets are printed by any script.

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
AI_DAILY_LIMIT=50            # optional 0..1000
AI_USER_DAILY_LIMIT=5        # optional 0..1000
```

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
npx --yes npm@11.21.1 test            # 45 app tests (vitest)
node --test scripts/release-checks.test.mjs   # built-in release script tests, no deps

# 4. Production build — demo, AI off, no secrets (CI does this)
APP_MODE=demo AI_ENABLED=false GOOGLE_AUTH_ENABLED=false npx --yes npm@11.21.1 run build

# 5. HTTP smoke — existing origin
node scripts/smoke-http.mjs --expect=demo
node scripts/smoke-http.mjs --expect=demo --origin=http://localhost:3000
node scripts/smoke-http.mjs --expect=live --origin=https://re-love-pi.vercel.app

# 6. HTTP smoke — auto-start production server on free port, always cleans up
node scripts/smoke-http.mjs --start --expect=demo
node scripts/smoke-http.mjs --start --expect=demo --port=3100 --timeout=8000
```

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

* This checkout is **validation sidecar only** — no schema push, no `git push`, no Vercel deploy. Migrations `supabase/migrations-draft/001_initial.sql` and `002_ai.sql` are **owner-approved frozen drafts**; application to the Tokyo (`ap-northeast-1`) Supabase project happens via the primary track after the final builder commit (not here).
* CI builds demo with `APP_MODE=demo AI_ENABLED=false GOOGLE_AUTH_ENABLED=false` and no secrets for public smoke; production runtime is already `APP_MODE=live GOOGLE_AUTH_ENABLED=true AI_ENABLED=false` in Vercel and local `.env.local`.
* No paid AI calls; smoke never sends provider credentials. AI routes stay 503 disabled until owner later enables with `BASETEN_API_KEY`/`META_API_KEY`.

## Remaining verification (outside this checkout)

1. **Primary track applies approved migrations** — `001_initial.sql` / `002_ai.sql` to remote DB after builder final commit.
2. **Google sign-in E2E** — production OAuth redirect already confirmed; full 2-account flow (login → `auth/callback` → protected POST → thread/message → logout) still needs test on `re-love-pi.vercel.app`.
3. **Live smoke (post-apply)** — `node --env-file=.env.local scripts/check-env.mjs --strict` and `node scripts/smoke-http.mjs --expect=live --origin=https://re-love-pi.vercel.app`.
4. **Optional AI** — if enabling later, set `AI_ENABLED=true` plus at least one provider key and non-zero caps; DB `ai_budget`/`ai_settings` remain hard upper caps.

No further owner approvals needed — this doc does not re-ask for decisions already made.

## Changed paths (this release layer only)

* `scripts/check-env.mjs` — robust ESM CLI, server-only credential checks, localhost https exception, zero-cap allowed, service_role misuse rejected, `NEXT_PUBLIC_*` forbidden, repo-leak warning, never prints secrets.
* `scripts/smoke-http.mjs` — ESM fetch-only GETs, manual redirect/same-origin, bounded bodies/timeouts, `--expect` mode contract, HTML + health/session/categories/listings/pagination/detail/private-API/PWA/no-store checks, `--start` spawns production Next on free port and always cleans up.
* `scripts/release-checks.test.mjs` — `node:test` built-in tests for checker failures, `--help`/exit codes, redirect and body-limit boundaries; run via `node --test`.
* `.github/workflows/ci.yml` — least-privilege `contents:read`, PR+push `main`, concurrency cancel, Node 22.14, `npx --yes npm@11.21.1 ci`, lint → typecheck (next typegen before tsc) → tests → `node --test` release checks → demo build (no secrets) → `--start` demo smoke.
* `docs/RELEASE.md` — this file.

## Tests run locally

```
node scripts/check-env.mjs --help                          # 0
node scripts/check-env.mjs                                 # 0 (demo, no env)
node --env-file-if-exists=.env.local scripts/check-env.mjs # 0
npx --yes npm@11.21.1 ci                                   # ok
npx --yes npm@11.21.1 run lint                             # ok
npx --yes npm@11.21.1 run typecheck                        # ok
npx --yes npm@11.21.1 test                                  # 45 passed (builder)
node --test scripts/release-checks.test.mjs               # passed (release layer)
APP_MODE=demo AI_ENABLED=false GOOGLE_AUTH_ENABLED=false npx --yes npm@11.21.1 run build  # ok demo build
node scripts/smoke-http.mjs --start --expect=demo          # 0 (demo HTTP smoke)
```

## Remaining limits / integration note

* This checkout `t3-a09c7a1a` is release sidecar only (early skeleton page remains); full marketplace `src/app` lands via builder integration from `t3-89478c46`. `check-env`/`smoke-http` already target the final contract, so they light up fully once that commit merges.
* `next typegen` before `tsc` required on clean checkouts (`.next/types` generation) — CI encodes this.
* `npm ci` via `npx --yes npm@11.21.1 ci` avoids the npm10 `edgesOut` bug.
* Contract verified against `src/lib/server/env.ts`, `src/lib/ai/context.ts`, `src/app/api/health/route.ts`, `src/lib/server/queries.ts`, `supabase/migrations-draft/001_initial.sql` + `002_ai.sql` — no mismatch; future `ApiResponse {data,mode,meta}` / health `setup503` drift will fail smoke.
