# Phase 2 AI — Baseten + Meta hardening

This doc is the backend implementation record for `src/app/api/ai/**`, `src/lib/ai/**`, `scripts/smoke-ai.mjs`, AI tests, and schema assessment. Frontend UX (sell form) is owned by the Frontend Muse; API contracts stay per `docs/IMPLEMENTATION-CONTRACT.md`. No frontend, schema, env, deployment, lockfile, or lint config was changed here.

## 1. Provider verification (primary docs, 2026-11-02)

### Baseten Muse Spark Open via Baseten Model APIs
- Endpoint `POST https://inference.baseten.co/v1/chat/completions` with OpenAI-compatible body (`model`, `messages`, `max_tokens`). [docs.baseten.co/reference/inference-api/chat-completions](https://docs.baseten.co/reference/inference-api/chat-completions.md)
- Vision: `content` array with `{type:"image_url", image_url:{url}}` where `url` may be base64 data URL (OpenAPI `ImageURL.url` description). Baseten vision limits: Muse Spark Open max 8 images, 10 MB per image URL, 100 MiB request body. We send one image as `data:image/jpeg;base64,...` ≤2 MB, well within limits. [docs.baseten.co/inference/model-apis/vision](https://docs.baseten.co/inference/model-apis/vision.md)
- **Unsupported — explicitly not used:** Structured outputs and JSON mode are not enforced for Muse Spark Open. Docs: “All except Muse Spark Open support structured outputs and JSON mode” and “Muse Spark Open accepts `json_object` but doesn’t constrain output to JSON. Ask for JSON in your prompt and validate.” [overview](https://docs.baseten.co/inference/model-apis/overview.md), [structured-outputs](https://docs.baseten.co/inference/structured-outputs.md), [json-mode](https://docs.baseten.co/inference/json-mode.md). We request plain text JSON and validate with Zod strictly; we never set `response_format`.
- Model slug: Table lists `meta-models/muse-spark-open`; project default is `meta-models/muse-spark-open-1026` (via `BASETEN_MODEL`). Must be verified with the app’s own Baseten account before enabling. Coordinator owns keys.

### Meta Muse Voice Transcribe
- Endpoint `POST https://api.meta.ai/v1/asr/transcribe`, multipart `request` (JSON `{model:"muse-voice-transcribe-1.0", audioEncoding:"WAV", mode:"PUSH_TO_TALK", languageBias:["English","Tamil"]}`) + `audio` (WAV file), `Accept: application/json`. Verified via [API reference transcribe](https://dev.meta.ai/docs/api-reference/voice/transcribe) and [speech-to-text](https://dev.meta.ai/docs/speech-to-text). Caps: 32 MB body, 10 min audio; we enforce stricter 60 s / 3 MB for campus use.
- Unsupported not used: `ENDPOINTING`, `DIARIZATION`, WebSocket realtime, word timestamps, confidence/sound-event per-word — we use only `PUSH_TO_TALK` buffered transcript.

### Meta SAM 3.1 segmentation
- Endpoint `POST https://api.meta.ai/v1/responses`, `model:"sam-3.1"`, `stream:true`, `metadata:{mask_encoding:"one_bit"}`, `input:[{type:"message", role:"user", content:[{type:"input_text", text:<noun phrase>}, {type:"input_image", image_url:"data:image/jpeg;base64,..." or https URL}]}]`. Verified via [SAM client libraries](https://dev.meta.ai/docs/sam/client-libraries) and [segmenting with prompts](https://dev.meta.ai/docs/sam/segmenting). Parser `@meta-sam/parser` 0.1.0 is official and does not send requests; we use `parseImageStream` + `decodeMaskToRaster`.
- Prompt rule: short noun phrase (“yellow school bus”), not commands/questions; one concept per request; we sanitize `listing.title` to ≤80 chars fallback “item”. See `src/lib/ai/cutout.ts: sanitizePrompt`.
- Unsupported not used in current cutout: video (`input_video`, `file_id`, `propagation_direction`), confidence (`include_confidence`), box/point prompts (`buildObjectPrompt`), `lossless` encoding (we choose `one_bit` for size). Accounted for explicitly in proposal below.

## 2. Hardening applied (this worktree)

- **Original photo source of truth:** Cutout route only updates `cutout_path/url` after the derived JPEG is validated; DB compare `image_path` unchanged; storage upload is cleaned up on failure and original is never overwritten. Draft never invents condition/brand/edition — forced null after parse.
- **No invented brand/edition/condition or prices:** `aiDraftSchema` strict rejects extra keys like `price`; `parseAiDraft` forces `brand=null, edition=null, condition_hint=null`; `DRAFT_PROMPT` instructs null for unsure and forbids price/brand/edition/defects. Frontend must still require seller confirmation via `seller_confirmed:true`.
- **Server-only secrets:** All provider keys read only via `process.env.BASETEN_API_KEY`/`META_API_KEY` in server routes (`requireAiContext`); no `NEXT_PUBLIC`, no browser Supabase client, no secret copy.
- **Auth+ownership+same-origin:** `requireAiContext` calls `requireUser()` (real `supabase.auth.getUser()`); draft checks `image_path.startsWith(user.id/)` and downloads owned file; cutout selects listing `eq(seller_id,user.id)` and claims with `ai_status` check; all routes via `withApi` which enforces `assertSameOrigin`.
- **Zod all inputs/provider outputs:** `draftRequestSchema`, `imagePathSchema`, `uuidSchema`, `validateWav`, provider `completion` schema, transcript `z.object({transcript:...}).strict()`, SAM event `eventSchema`. Bad JSON triggers `AI_INVALID_JSON` retry (once).
- **Kill switch + atomic caps:** `AI_ENABLED !== "true"` or missing key or zero caps → `AI_DISABLED` 503. Ledger `reserve_ai_usage(p_feature,p_daily_limit,p_user_limit)` does `FOR UPDATE` on `ai_budget` and returns `allowed,usage_id,reason`; `complete_ai_usage` only touches caller’s reservation. Counters count pending/failed, including retries.
- **Timeout, max two retries incl bad JSON retry, manual fallback:** Guard deadline `min(20000, timeoutMs)`, `min(2, maxRetries)`. Draft 1 retry (JSON repair), transcribe 1, cutout 0 — all ≤2. Retryable only on 429/5xx. All failures throw `503 AI_*` or `429 AI_LIMIT` with “You can continue manually” and the contract’s `manual fallback` message.
- **Correct mask size/fragmentation & preserve original:** `checkMask` rejects dimensions>4M, coverage<0.015 tiny, >0.95 full_frame, components>20 or largest/filled<0.85 fragmented. Cutout collects candidates, requires exactly 1 valid mask (`MASK_AMBIGUOUS` otherwise). Derived image is flattened over `#f2f1ed` at quality 84 only after validation.
- **No blind trust of provider URLs:** Draft never fetches URLs from model output; it uses only the owned Supabase download as input. SAM cutout ignores any provider media URLs and re-embeds the original as data URL; event parser only yields typed `type` events, never fetches image URLs. Storage public URL is derived from Supabase, not provider strings.
- **Schema read, not changed:** Existing `supabase/migrations-draft/001_initial.sql` + `002_ai.sql` were read; `ai_budget` single-row lock, per-feature `ai_settings`, `ai_usage` with atomic RPCs are used as-is.

## 3. Cutout execution reliability audit (Vercel)

**Current execution model (no new infra):**
- Route `POST /api/ai/cutout` is `runtime:nodejs`, `maxDuration:30`, guard timeout 20s, fetch `signal` + buffered 6 MB SSE limit. Typical timings: sharp metadata+decode 80–300 ms, SAM stream 8–15 s for 1600px image (one_bit), mask raster decode+resize 100–400 ms, JPEG encode 80–200 ms. Fits Vercel Pro 30 s and guard 20 s simultaneously.
- **Risk:** Vercel Hobby tier default is 10 s; this route would reliably 504 on Hobby. Pro/Enterprise 30 s is required and is already the repo’s `maxDuration:30`.
- **Cold start + sharp:** `sharp` native module cold start adds ~400–900 ms on nodejs 22; still within budget but leaves ~4–6 s margin under 20 s.
- **Concurrency & idempotency:** Single-owner claim via `update ... ai_status='pending' where ai_status!=pending OR updated_at<now-60s`. Stale pending older than 60 s can be re-claimed; concurrent callers get `409 CUTOUT_PENDING`. No durable queue; a second request after 60 s overwrites stale pending without duplicate work.
- **Failure handling:** On any exception, set `ai_status='failed'` and delete the just-uploaded cutout blob if present; never delete original. `LISTING_CHANGED` (409) fires if `image_path` changed mid-flight, proving original was not replaced.
- **No new background infra:** Not adding queues/functions per spec without proposal. The bounded request is the audit outcome.

**Proposal if we add background infra (only with concrete owner approval):**
- Option: Vercel Queues / Upstash QStash or Supabase pg_cron + storage-triggered Edge Function that runs `makeCutout` with `maxDuration:60`, retries with backoff, and writes `ai_usage` separately. Needs new table `ai_jobs(id, listing_id, status, attempts, error)` and RLS. Not implemented here — assess after stable cutouts, gated behind AI_ENABLED and budget caps.

## 4. Scope assessment: next-phase multi-object still-image & later video

### Next phase — multi-object still-image cutouts (recommended scope)
- **Concrete scope:** Allow `listing.images` (N still images) segmentation with user-selected object via text phrase or single box/point per image, returning up to 16 masks per image, one derived cutout per object.
- **Limits:** Still images only (no video), max 4 images per listing, 1600px per side, 2 MB each, 16 masks per image, `one_bit` encoding, synchronous request ≤30 s; ambiguous >1 valid masks per prompt returns manual fallback; preserve all originals.
- **Schema proposal only (not implemented):**
  ```sql
  -- add to listings or new table
  alter table public.listings add column if not exists cutouts jsonb default '[]'::jsonb; -- [{prompt text, cutout_path, cutout_url, bounds, confidence}]
  -- or preferred normalized:
  create table public.listing_cutouts (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid not null references public.listings(id) on delete cascade,
    prompt text not null check (char_length(prompt) between 1 and 80),
    cutout_path text not null check (cutout_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$'),
    cutout_url text not null,
    bounds jsonb, -- {left,top,right,bottom}
    created_at timestamptz not null default now(),
    unique(listing_id, cutout_path)
  );
  create index on public.listing_cutouts(listing_id);
  ```
  RLS: owner can insert/select/delete their cutouts; public cannot read hidden listings’ cutouts. Atomic caps: one `reserve_ai_usage('cutout',...)` per cutout attempt. Frontend: object picker (tap to tag) using `buildObjectPrompt` size conversion.

### Later gated option — video
- **Scope:** Short campus clips (≤10 s, ≤30 fps, ≤15k frames but gated to 10 s/300 frames, MP4/MOV H.264/H.265) segmented with concept or box prompts, tracked via `propagation_direction` (forward/both). Returns per-frame boxes/masks; we would store only selected frame cutouts, not full video masks.
- **Limits:** Must enforce billing per-frame (minimum 50 frames), file upload via Files API `purpose:user_data`, `video_url` or `file_id`, `stream:true`, large payloads (100 s of MB) — requires background job + storage lifecycle, not bounded 30 s request. No auto-publish; seller confirms. Requires new `ai_settings` feature `cutout_video` with separate lower caps.
- **Schema proposal only:**
  ```sql
  create table public.listing_video_cutouts (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid not null references public.listings(id) on delete cascade,
    file_id text not null, -- Meta Files API id
    prompt text not null,
    status text not null default 'pending' check (status in ('pending','done','failed')),
    result jsonb, -- frames [{frameIndex, bounds, mask_encoding}]
    created_at timestamptz not null default now()
  );
  ```
  Plus budget: add `('cutout_video', false, 10, 2)` to `ai_settings`. Gated behind `AI_ENABLED` and explicit video opt-in; needs Vercel Cron or pg_cron cleanup of Files API uploads and long-running worker (60–120 s), not in this phase.

## 5. Remaining credential/provider blockers (no paid calls made)

- **Keys not set:** `BASETEN_API_KEY` / `BASETEN_MODEL` and `META_API_KEY` are not configured in this worktree; coordinator sets them server-side. All AI routes return `503 AI_DISABLED` / `AI_UNAVAILABLE` with manual fallback until then.
- **Model slug verification:** Confirm `BASETEN_MODEL` exists in the app’s Baseten account (`/v1/models` or dashboard). Try `meta-models/muse-spark-open-1026` first; if 404, use `meta-models/muse-spark-open`.
- **DB budgets must be enabled:** Migrations `002_ai.sql` must be applied, then `update ai_budget set enabled=true` and `update ai_settings set enabled=true where feature in ('draft','transcribe','cutout')` with caps (`daily_limit`, `per_user_limit`). Until then `reserve_ai_usage` returns `disabled`.
- **AI master switch:** `AI_ENABLED=true` plus non-zero `AI_DAILY_LIMIT`/`AI_USER_DAILY_LIMIT` in Vercel/local. Smoke: `node --env-file=.env.local scripts/check-env.mjs --strict` must pass, then `SMOKE_SESSION_COOKIE` draft smoke via `npm run smoke:ai -- <owned-path>`.
- **Ten-photo & audio checklist still needs real owner photos/recordings:** English/Tamil/mixed, failure cases (dark, cluttered, tiny object).

## 6. Frontend requirements (for sell form owner)

- Send `POST /api/ai/draft` with `{image_path? , transcript?}` (at least one). Handle `401` (login), `429` (budget), `503` (disabled) by showing manual form fallback; surface `error.message` (“You can fill in the listing yourself.”). On success, prefill only `suggested_fields` and show diff; require `seller_confirmed:true` before create/update.
- Never display `brand`/`edition`/`condition_hint` from draft; keep disabled in UI. Validate tags (≤12, lowercase) before submit.
- Voice: `POST /api/ai/transcribe` multipart `file`; handle `413/400` WAV errors; show transcript for seller edit, not auto-publish.
- Cutout: `POST /api/ai/cutout` `{listing_id}` only after publish; show `CUTOUT_PENDING` 409 retry hint, preserve original on `failed`; do not request cutout on unsaved draft.

Provider docs used: Baseten overview/vision/json-mode/structured-outputs/chat-completions, Meta voice transcribe, SAM client-libraries/segmenting.
