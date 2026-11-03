# Availability — Re-Love judging-window probe

**This is a local candidate only.** This file/workflow is not deployed or active until merged to the default branch (`main`) in the canonical repository `Shuba-Matam/ReLove`. Until integrated, it makes no requests and has no effect.

## What it does

- Bounded, read-only `GET /api/health` probe against the canonical origin `https://re-love-pi.vercel.app`
- Validates live readiness: `200` + `Cache-Control: private, no-store` + envelope `{ data:{ status:'ok', mode:'live' }, mode:'live' }`
- `demo` / `setup` / `503` / malformed / missing `no-store` / redirect / oversized / timeout all correctly fail — never reports false healthy
- Uses explicit `Cache-Control: no-store` request to defeat cached readiness (response must also contain `no-store`)
- HTTPS for production, HTTP only for loopback (`localhost`/`127.0.0.1`/`::1`) — rejects `userinfo`/`path`/`query`/`hash` in origin
- `redirect: manual`, single request, no retries, `AbortSignal` timeout includes body consumption, bounded body bytes (default 32768)
- Safe errors: never prints arbitrary response text, `Authorization`, or `Cookie` values

## Planned load

- Workflow `.github/workflows/availability.yml` — scheduled `17 3,15 * * *` (twice daily, off top of hour)
- `2 requests/day × ~14 days = <=28 requests` until cutoff `2026-11-17T00:00:00Z` (end of November 16 UTC)
- No `npm install`, no secrets, `contents: read`, Node 22.14, job timeout 3 minutes, concurrency group

## Hard bounded judging window

- **Cutoff:** `2026-11-17T00:00:00Z` (November 16 end UTC, inclusive). On or after this instant the checker and workflow make **zero network requests**, even on manual `workflow_dispatch`.
- Source guard lives in `scripts/check-availability.mjs` (`isExpired()` / `CUTOFF_MS`) and is unit-testable via `--now` / `--cutoff` injection; tests verify boundary and zero-request behavior.
- Workflow passes `--cutoff=2026-11-17T00:00:00Z` explicitly; script also defaults to the same instant if flag omitted.
- After expiry the run logs `SKIP` (exit 0) — distinct from `PASS` — so judges see a clear skipped state, not false healthy.
- Failure is visible as a failed check on the commit; the workflow does **not** send messages, emails, or create issues.

## Limitations — what this does not do

- **Not deployed/active locally:** the candidate workflow only runs after integration to `main` (see GitHub schedule note below). This doc itself is the local proposal.
- **No uptime guarantee:** a passing probe proves momentary `/api/health` live readiness, not continuous availability.
- **No Supabase pausing prevention guarantee:** free-project pausing docs note _“a few daily app DB requests usually enough”_ — see https://supabase.com/docs/guides/platform/free-project-pausing — but pausing can still occur; this probe is best-effort visibility, not a keep-alive contract.
- **No live data mutation, auth, credentials, push, schema, or notification sending** — network-free after cutoff, read-only always.

## Manual / local use

```sh
node scripts/check-availability.mjs --help
node scripts/check-availability.mjs
node scripts/check-availability.mjs --origin=http://127.0.0.1:3000 --timeout=4000 --json
# cutoff testing (never hits network when --now >= cutoff)
node scripts/check-availability.mjs --now=2026-11-17T00:00:00Z
node scripts/check-availability.mjs --cutoff=2026-11-17T00:00:00Z --now=2026-11-16T23:59:59Z
```

Tests (no external network, fake fetch + local HTTP stubs cover timeout/redirect/oversized/demo/cutoff/leakage):

```sh
node --test scripts/check-availability.test.mjs
node --test scripts/release-checks.test.mjs  # includes availability via additive import
npm run test:release
```

## Official docs verified

- GitHub scheduled workflows: `schedule` runs on the default branch, may delay at high load, and is disabled after 60 days repo inactivity — https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Supabase free-project pausing: inactive free projects are paused; a few daily DB requests are _usually_ sufficient to prevent pausing, but not guaranteed — https://supabase.com/docs/guides/platform/free-project-pausing
