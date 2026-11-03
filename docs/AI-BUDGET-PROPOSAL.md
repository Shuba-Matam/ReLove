# AI Budget Hardening — Review Only (DO NOT APPLY)

Existing migrations `supabase/migrations-draft/001_initial.sql` and `002_ai.sql` were applied 2026-11-01; candidate `docs/drafts/003_ai_budget_hardening.sql` is **review-only, no live change** in this branch. See candidate SQL for exact schema.

**Credits pending owner choice:** 150 META credits exclusively for app (draft/voice/cutout via `api.meta.ai`); 100 Baseten credits separate for coding. Exact credit→micro-USD conversion and per-provider reserve allocation **not yet confirmed**; candidate defaults to disabled, caps null, pricebook empty, reserves 0. No paid tests; all gates off (`AI_ENABLED=false`, `ai_budget.enabled=false`).

## Scope
- Listing-only AI: `POST /api/ai/draft|transcribe|cutout` only; each attempt incl. retry/fail/timeout atomically billed at worst-case; no price prediction; brand/edition/condition forced null.
- Approved provider: `muse-spark-1.3` standard (no Contributor/training) for drafts via Meta credits; Baseten `meta-models/muse-spark-open-1026` compatibility retained, no silent fallback. Voice `muse-voice-transcribe-1.0`, SAM `sam-3.1`.

## Current (002)
`ai_budget(id,enabled,daily_limit,per_user_limit)`, `ai_settings(feature,enabled,daily_limit,per_user_limit)`, `ai_usage` with `reserve_ai_usage(p_feature,p_daily_limit,p_user_limit)` / `complete_ai_usage` via `FOR UPDATE`. Counts pending/failed per UTC day.

## Candidate (003) — exact
- `ai_budget` adds `meta_micro_usd_cap/used`, `meta_reserve_micro_usd`, `baseten_micro_usd_cap/used`, `baseten_reserve_micro_usd` (per-provider, not shared pool). Keeps legacy `reserve_micro_usd` unused. Null/missing/nonpositive cap **rejects**; `reserve<=cap` validated per-provider; `cap - reserve` is spendable.
- `ai_pricebook(feature pk, provider, model, max_cost_micro_usd, enabled, input_max_chars, output_max_tokens, max_duration_sec)` — **empty by default** until owner inserts verified ceilings. Missing/disabled/mismatched provider+model rejects. Candidate ships with no rows; example commented fixtures: `draft 8500` (1200*4.25/1M=5100 output alone + buffer, rounded), `transcribe 3500` (60s*0.18/3600=3000 + round), `cutout 4000`, `moderation 6000` — labeled `TEST ONLY, not production`, conservatively rounded integer microUSD.
- `ai_operations(user_id,feature,idempotency_key,source_hash,provider,model,price,status,attempt_count)` unique `(user_id,feature,idempotency_key)`; stable identity binds `source_hash` — same key with changed source → `source_mismatch` reject. `ai_attempts(operation_id,provider,model,price)` max 3 per operation across HTTP requests; `pending` atomically before provider.
- Duplicate `done`/`pending` returns `allowed=false, disposition duplicate_*` with cached result, **never** `allowed=true`; provider executes only with fresh `attempt_id` claim. Completion fenced to current claim (`stale` rejected); errors/timeouts billed full bound, **no refund RPC**.
- Preserves `ai_settings.enabled/daily/per_user` checks; stricter of DB vs `p_daily_limit/p_user_limit` (env) wins. Lock `FOR UPDATE` on budget before idempotency lookup.
- RLS + revokes: `ai_pricebook/operations/attempts` RLS deny default, `authenticated` may only `select` own rows/audit; `anon/authenticated/public` revoked for both old and new RPCs; **only `service_role` via `SUPABASE_SERVICE_ROLE_KEY` may `reserve_ai_attempt(p_user_id,...)`/`complete_ai_attempt`** (`p_user_id` from verified `requireUser`). Ordinary marketplace CRUD stays `authenticated+RLS`, no `service_role`. Missing metering credential **fails closed**, no fallback to old ledger.
- Default disabled: `ai_budget.enabled=false`, pricebook empty, caps null, reserves 0. No spend until owner configures conversion+reserve.

## Verification & app integration
- Local candidate applied via PGlite in tests; no live DB change. `npm test` and `npm run test:release` must pass before owner approval.
- App: `AI_HARD_BUDGET=true` enables metering path with `SUPABASE_SERVICE_ROLE_KEY` (server-only, never `NEXT_PUBLIC`); missing candidate/credential → 503 fail-closed. Default `false` keeps legacy `reserve_ai_usage` usable before schema installed but **does not claim monetary protection** (`/api/session` exposes `ai_hard_budget`/`ai_metering_configured`/`ai_hard_budget_ready`). Routes send `source_hash`+`idempotencyKey` and handle `duplicate_done` (cached) / `pending` (409). `getAiFeatureAvailability` fails closed on invalid provider/model, does not pretend DB ready, moderation forced `false` (Meta-only intent, no silent Baseten charge).
- Provider verification: Baseten `https://inference.baseten.co/v1/chat/completions`, Meta `https://api.meta.ai/v1/chat/completions` + `/asr/transcribe`, `/responses` — fixed endpoints, allowlisted `muse-spark-1.3`, no arbitrary fetch.
- Tests cover via actual guard+meter adapter+route mocked fetch: nullable cap, price/provider mismatch, disabled feature, daily/per-user (incl. `ai_settings`), protected reserve, duplicate no second provider, source mismatch, failed-retry counted max3 fenced, bound fixtures (60s voice, 1200 draft), attacker cannot mark done, lock SQL order, concurrency limitation noted, guard bounded waits (delayed reserve, complete hang). No public refund.

## Pending owner inputs
- Credit→microUSD conversion for 150 Meta credits and per-provider reserve split.
- Verified price ceilings per feature/provider/model/bounds to populate `ai_pricebook` enabled.
- Trusted metering credential `SUPABASE_SERVICE_ROLE_KEY` server-only setup (Vercel env, never client). Until supplied, `AI_HARD_BUDGET` stays `false`, no live monetary enforcement.

## Files
- `docs/drafts/003_ai_budget_hardening.sql` — candidate; `src/lib/ai/meter.ts` — metering client (service_role confined); `src/lib/ai/context.ts` — hard-budget vs legacy branching; `src/lib/ai/guard.ts` — bounded waits, deadline, complete hang; `src/lib/server/env.ts` — fail-closed provider/model, moderation disabled, DB≠env; API routes — source identity + duplicate handling; `tests/budget-candidate.test.ts` — candidate via PGlite; `tests/ai.test.ts` — guard deadline/complete hang.
