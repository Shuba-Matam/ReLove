# Phase 2 AI readiness

AI routes are implemented but production provider calls remain unverified. The core and AI migrations were approved and applied on November 1, 2026; do not reapply them. No schema change is part of this patch.

## Provider contracts

- Drafts use Baseten chat completions with one inline image and optional seller transcript. Muse JSON is requested as text and validated with Zod; no response_format is sent. Default model: meta-models/muse-spark-open-1026. Verify availability with the application account; do not silently substitute models. [Vision](https://docs.baseten.co/inference/model-apis/vision.md), [JSON mode](https://docs.baseten.co/inference/json-mode.md).
- Voice uses Meta POST /v1/asr/transcribe, multipart request and audio, muse-voice-transcribe-1.0, PUSH_TO_TALK and English/Tamil hints. Accept mono 16-bit PCM WAV at 16/24 kHz, at most 60 seconds and 3 MB. The response includes sessionId, audioDurationMs and turns; only the validated transcript reaches the browser. [Response schema](https://dev.meta.ai/docs/api-reference/voice/schemas).
- Cutouts use Meta POST /v1/responses, sam-3.1, streaming one-bit masks, the inline original photo and a bounded text prompt. The installed @meta-sam/parser decodes masks. [Client libraries](https://dev.meta.ai/docs/sam/client-libraries), [segmentation](https://dev.meta.ai/docs/sam/segmenting).

## Safeguards and frontend contract

- Provider calls require login, server-only keys, same-origin mutations, AI_ENABLED=true and atomic existing database budgets. Defaults remain disabled, 50 global attempts/day and 5/user/day, UTC. Failures and retries count.
- The provider operation has a 20-second deadline. Draft and voice allow one retry; cutout allows none. The guard permits at most two retries. Database and storage operations also take time; the provider deadline does not prove total end-to-end latency.
- POST /api/ai/draft takes {image_path?, transcript?}, at least one required, and returns {draft,suggested_fields}. Model-supplied prices fail validation; brand, edition and condition hints become null. Prefill only suggested fields; sellers choose condition/price and confirm before publishing.
- POST /api/ai/transcribe takes multipart file, returns {transcript} for editing. Posting remains available without voice or AI.
- POST /api/ai/cutout takes {listing_id} after publication for the owner and returns {status}. Pending requests return 409. Tiny (<1.5%), near-full-frame (>95%), fragmented or ambiguous masks retain the original. Derived images never overwrite the source.
- Provider output URLs are not fetched. Source ownership is checked; failed derived uploads are cleaned up where possible.

## Deployment and verification

Routes request maxDuration=30. Vercel's documented Hobby ceiling supports this: 300 seconds with Fluid compute, or 60 seconds without it. A paid-plan upgrade is not required for this setting. Verify the deployed configuration; no provider timing or cold-start performance has been measured. [Vercel duration limits](https://vercel.com/docs/functions/configuring-functions/duration).

Cutouts are bounded owner-triggered requests, not durable background jobs. Stale pending claims can be retried after 60 seconds; process termination can leave cleanup for a later attempt. Do not describe this as automatic background processing.

Before activation:

1. Supply application BASETEN_API_KEY and META_API_KEY privately to server environments. Coding-agent Baseten access does not configure these keys.
2. Verify model availability and credit/usage access.
3. Enable only features being tested through existing settings, preserving global/user limits. No migration is needed to toggle existing settings.
4. Run npm run smoke:ai -- <owned-upload-path> or npm run smoke:ai -- --transcript "a chair" with a private SMOKE_SESSION_COOKIE. Output excludes image paths, transcripts and credentials.
5. Test owner photos and English/Tamil/mixed recordings; confirm seller edits, synonyms, mask quality, original toggle and manual fallback. Exercise off/bad-key/timeout/broken-JSON/cap scenarios before release.

## Proposed following phase: several items from one image

Proposed scope, awaiting product confirmation: one room photo, seller selects which detected items to list, then reviews a separate draft and cutout for each item. Start with at most four selected items from one image. No automatic publication or multi-photo listing redesign. Preserve the original as evidence; measure segmentation quality and usage before choosing final limits.

This needs object selection, independent draft review and safe source/cutout ownership and deletion. Assess whether existing contracts suffice; present any concrete schema change for approval before implementation. No speculative tables or migrations are included.

Video remains a later feasibility check. First consider seller-selected still frames from a short clip; full multi-object tracking adds processing, cost, duplicate-item handling and cleanup. Confirm desired output and measure provider performance before choosing duration, frame limits or background infrastructure. No video implementation or schema change is included.
