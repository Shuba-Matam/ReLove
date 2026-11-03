# AI Budget Hardening — Review Only (DO NOT APPLY)

Existing migrations `supabase/migrations-draft/001_initial.sql` and `002_ai.sql` were applied 2026-11-01 and must not be reapplied. Candidate `docs/drafts/003_ai_budget_hardening.sql` is review-only; no live schema change in this worktree.

**Credits:** 150 META credits exclusively for the APPLICATION draft/voice/cutout via `api.meta.ai`; Baseten 100 credits separate for coding subagents. Exact META credit→USD conversion and judging reserve not yet confirmed; candidate defaults to disabled, zero spend, pricebook disabled, reserve 0 until approved. No paid Meta/Baseten tests authorized; all gates remain off (`AI_ENABLED=false`, `ai_budget.enabled=false`, pricebook disabled).

## Truth and scope
- AI disabled by default: env and DB both must be true; DB caps are hard upper bounds. No enable/deploy without owner confirmation.
- Owner APPROVED `muse-spark-1.3` standard (no Contributor/training) at `https://api.meta.ai/v1/chat/completions` for listing labels/descriptions using Meta app credits; retains optional Baseten `meta-models/muse-spark-open-1026` compatibility, no silent other-model fallback. All gates remain off.
- Listing-only AI: only `POST /api/ai/draft|transcribe|cutout` invoke providers; each attempt including retries/failures/timeouts counts atomically. Video OFF.
- Original is truth: AI never sets price; brand/edition/condition_hint forced null; seller confirms.
- Per-day caps do not guarantee lifetime credit survival; candidate adds per-provider micro-USD budget with protected reserve.

## Current state (002)
Tables `ai_budget(id bool pk, enabled, daily_limit, per_user_limit)`, `ai_settings(feature pk, enabled, daily_limit, per_user_limit)`, `ai_usage(id, user_id, feature, created_at, completed_at, ok, duration_ms)` with RLS and `reserve_ai_usage(p_feature,p_daily_limit,p_user_limit)`/`complete_ai_usage` via `FOR UPDATE` on budget. Counts pending/failed per UTC day.

## Candidate (docs/drafts/003)
Core idea: integer micro-USD per-provider budget with protected reserve, atomic worst-case per-attempt reservation from server-held bounded `ai_pricebook` (missing price rejects), operation identity `ai_operations(user_id,feature,idempotency_key)` separates request from attempts `ai_attempts`, duplicate returns cached/pending never permits provider anew, provider+price snapshotted, no user-callable refund; fail/timeout counts full max (no refunds in v1). Old RPC signatures revoked; new RPCs `reserve_ai_attempt`/`complete_ai_attempt` are only privileged path, revoked from public/anon/authenticated except trusted definer entrypoint that client cannot forge.

Tables/cols: `ai_budget` adds `meta_micro_usd_cap/used`, `baseten_micro_usd_cap/used`, `reserve_micro_usd`; `ai_pricebook(feature pk, provider, max_cost_micro_usd, enabled)`; `ai_operations` with unique `(user_id,feature,idempotency_key)` and status pending/done/failed; `ai_attempts` per try; `ai_usage` extended with provider/price/operation_id. RLS + revokes enforce least-privilege: normal app uses anon/authenticated RLS, no service_role CRUD; budget enforcement only via definer functions.

Default disabled: `ai_budget.enabled=false`, pricebook `enabled=false`, caps null, reserve 0. No spend until owner supplies credit→micro-USD mapping and reserve.

See candidate SQL for exact schema, checks, RLS/revokes, and least-privilege notes.

## Verification
No live schema change. Tests load `001+002` then candidate via PGlite and check parallel reservations, duplicate, no-refund, unknown-price rejects. Candidate must pass `npm test` and `npm run test:release` before approval.

## Provider verification
- Baseten: `https://inference.baseten.co/v1/chat/completions` model `meta-models/muse-spark-open-1026`, vision via `image_url` data URL, no structured output.
- Meta: `https://api.meta.ai/v1/chat/completions` model `muse-spark-1.3` with vision, verified via https://dev.meta.ai/docs/cookbook/quickstart-chat-completions and /protocols/chat-completions. Muse Spark 1.3 ≠ Muse Spark Open. No Contributor variants.
- Voice `https://api.meta.ai/v1/asr/transcribe` muse-voice-transcribe-1.0, SAM `https://api.meta.ai/v1/responses` sam-3.1. No arbitrary endpoint (`META_CHAT_ENDPOINT` removed).

## Files changed
- `src/lib/ai/provider.ts` — fixed 401/402/403/429/413/400 classification with distinct messages, fixed endpoints, allowlisted `muse-spark-1.3` (no Contributor), single selector, fail-closed, retain Baseten compatibility.
- `src/lib/ai/guard.ts` — fail-closed deadline after reserve, record reserved failure, bound ledger waits, no free retry, hard max2, no pointless retry 401/402/403/400/413, bounded delayed 429 only if enough deadline.
- `src/lib/server/env.ts` — share single selector, fail-closed caps (NaN→false), env availability ≠ DB readiness, no provider secrets.
- `src/components/forms/sell-form.tsx` / `src/app/listings/[id]/detail-client.tsx` — per-feature UI, cutout detail respects `ai_features.cutout`.
- `docs/drafts/003_ai_budget_hardening.sql` — candidate migration; `docs/AI-BUDGET-PROPOSAL.md` now references it.
- `tests/ai.test.ts` — updated classification, provider, deadline/duplicate tests; `tests/database.test.ts` validates existing+candidate via docs/drafts explicitly.
