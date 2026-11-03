# Judging availability checks

This local candidate requires integration into the canonical repository's default branch before the schedule becomes active. It does not deploy the app or change its database.

## Behavior

The workflow runs twice a day at 03:17 and 15:17 UTC (08:47 and 20:47 IST). Each run makes one read-only request to `https://re-love-pi.vercel.app/api/health`. That existing endpoint reads categories and listings through the app's normal database client; the probe needs no secrets, authentication, package installation, or AI calls.

A pass requires HTTP 200, an exact `no-store` cache directive, and `{mode:"live", data:{status:"ok", mode:"live"}}`. Demo data, setup mode, redirects, oversized or malformed responses, and network failures fail the check. The default deadline is five seconds including body reads; the body limit is 32 KiB. There are no retries. Error bodies and arbitrary response values are never printed.

The health-request cutoff is fixed at **November 17, 2026, 00:00 UTC** (05:30 IST), covering November 16 UTC. After that instant, automatic and manual workflow runs print `SKIP` and make no health request. Clock injection is available only to imported unit tests; the CLI cannot override the clock or extend the cutoff. A skipped probe exits successfully but explicitly reports `ok:false, skipped:true`; it is not evidence that the app is healthy. GitHub still starts the workflow and performs checkout/setup until the workflow is disabled or removed.

There are at most 28 scheduled health requests from November 3 through November 16. Later integration reduces that number. Manual workflow runs or manual CLI invocations add requests before the cutoff. Both scheduled and manual workflow runs are restricted to the canonical repository and its default branch.

## Running locally

```sh
node scripts/check-availability.mjs --help
node scripts/check-availability.mjs --origin=http://127.0.0.1:3000 --timeout=4000 --json
# One live read-only request, only before the fixed cutoff:
node scripts/check-availability.mjs
```

The origin override accepts a bare HTTPS origin or HTTP loopback (`localhost`, `127.0.0.1`, `[::1]`). Userinfo, paths, query strings and fragments are rejected. A demo server intentionally fails live readiness.

```sh
node --test scripts/check-availability.test.mjs
npm run test:release
```

Tests use local HTTP servers and injected fetch/clock implementations, never the live deployment. They cover stalled headers and bodies, error responses that never finish, invalid origins, non-live envelopes, redirects, byte limits, fixed cutoff boundaries, CLI output redaction, and expired CLI behavior. The existing release-test entry point imports these tests, so the normal CI job runs them.

## Release and operational limits

Integrate the checked commits into `main`, then confirm the workflow appears in Actions. A manual run on the default branch can verify the deployed endpoint before judging ends. Disable or remove the workflow after judging to stop future skipped runs. The workflow uses only `contents: read` and creates no custom messages or issues; GitHub's own workflow notifications follow the account's settings.

A pass establishes momentary health, not continuous uptime. GitHub schedules can be delayed or dropped under load, run only from the default branch, and are disabled after 60 days of inactivity in public repositories: [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Daily database requests may help keep a free Supabase project active, but are not a guarantee against pausing: [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing). Check the dashboard and failure notifications during judging; this probe cannot restore a paused project.
