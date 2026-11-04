# Multi-cutout implementation and operating limits

Status: implemented locally behind `AI_MULTI_CUTOUT_ENABLED=false`. The existing text-prompt single-cutout flow remains available and its route, listing payload, and SQL contract remain compatible.

## What is feasible

The installed parser can represent multiple distinct mask records, and the existing composer can be reused once per selected mask. That proves the client library can carry multiple masks; it does not prove that an automatic text request will reliably find three separate saleable items, nor that three outputs will cost one provider attempt.

Meta's SAM guidance describes text prompting around one concept per request. Different item types therefore need separate text requests, while multi-object prompting in one request requires explicit box or point prompts. The installed `@meta-sam/parser` `buildObjectPrompt` helper supports an `objects[]` shape with stable object IDs. Automatic discovery of roughly three unrelated items would still need a separate detector/vision step, or user-provided boxes/points first.

## Implemented MVP

The separate `/sell/multiple` flow uploads one sanitized original and lets a seller draw or numerically edit up to three boxes. Merely marking, mounting the page, changing a candidate, previewing, or publishing does not contact SAM. The explicit generation action processes candidates sequentially and calls `/api/ai/cutout/item` once per item.

For each selected region:

- Candidate IDs are stable UUID-derived local IDs, independent of card order.
- Browser boxes use integer millionths of the displayed media. The server ignores browser dimensions, reads the stored image with Sharp, clamps a non-empty native half-open box, and includes that box plus source content hash/path/provider/model in the server-derived operation identity.
- SAM receives a box-only `buildObjectPrompt` with object ID `1` and frame `0`; no noun phrase is mixed into that request. A response must contain exactly one matching object mask and no other object IDs.
- Each successful item produces its own normal completed `cutout` operation and derived JPEG, so the existing listing validator and migration 004 source-binding trigger accept it without schema changes.
- A seller must load the actual preview, choose display mode, confirm details, and explicitly publish each listing. Publishing one returns to the remaining candidate cards; completed listing IDs remain visible.

Automatic item discovery should be a follow-up experiment after detector quality, latency, and cost are measured. Do not promise three usable returns from one text request.

## Metering and failure behavior

The implementation uses separate per-item operations. Up to three new cutouts can therefore consume up to three combined-account attempts. Defaults remain 15 attempts per ordinary authenticated user and 30 for an allowlisted owner when configured. A duplicate successful source/box operation is returned from the verified cache without a new provider call. Failed items have an explicit manual retry button; there are no automatic retries.

Authentication, global budget, credential, provider authorization, or feature-disable errors stop the remaining client queue while preserving earlier successes. Per-item parse, mask, quality, composition, or storage failures do not erase successful siblings. A successful response is not returned until storage succeeds and the metering completion transaction succeeds. Cached success is accepted only after checking the completed operation row and exact storage object.

The active combined quota counts provider attempts: 15 per ordinary account and 30 for an approved owner. Three cutouts must not silently be presented as three outputs for one credit; measured provider behavior and metering determine the real count.

## Cleanup and ownership

Reusing one original requires reference-aware cleanup. This MVP deliberately does not delete the shared original when a candidate is removed, another candidate is published, or the upload is replaced in the multi-item page. Published listing references remain protected by the existing checks. Abandoned originals and candidate previews are retained conservatively; there is no persistent batch/resume record or orphan expiry worker yet.

## Operational enable switch

Keep `AI_MULTI_CUTOUT_ENABLED=false` unless the existing AI master switch, Meta key, pricebook, database budgets, and cutout feature are also ready. Enabling this flag exposes the navigation link, `/sell/multiple`, and `/api/ai/cutout/item`; disabling it leaves the working single-cutout path untouched. No remote configuration, SQL, or provider request was performed during implementation.

## SAM postmortem and prevention

Two earlier image-pipeline failures were concrete:

- `removeAlpha` followed by channel joining produced a three-channel result without an alpha plane, so flattening could leave an output visually close to the original.
- A resized grayscale mask was materialized as expanded RGB bytes but later copied with a one-byte stride, which displaced asymmetric/off-origin masks.

The current compositor writes an explicit four-byte RGBA buffer from an exact three-byte RGB source and a one-byte alpha plane. Mask resizing explicitly extracts channel 0, verifies `channels === 1`, verifies the exact patch byte length and dimensions, then copies rows into a full one-byte canvas. The new box flow reuses these checks rather than accepting an RGB mask or inferring validity. Regression coverage includes asymmetric/off-origin placement, thin shapes, portrait/landscape coordinate conversion, 2:1 letterboxing, edge boxes, wrong/duplicate object IDs, zero/one/three mask selection, ownership, cache/storage completion, and two listings sharing one original.

Structured route logs contain only stage/error codes, request and operation IDs, scalar dimensions/counts/coverage/components, and elapsed time. They never include keys, source bytes, prompts, raw response bodies, or provider output text.

## Verification evidence

Local verification on November 4, 2026 completed without paid provider calls:

- `npm run lint` — passed.
- `npm run typecheck` — passed after Next route type generation.
- `npm test` — 16 files, 214 tests passed.
- `npm run test:release` — 68 release/CLI tests passed.
- `npm run build` — Next.js 16.4.3 production build passed and emitted `/sell/multiple` plus `/api/ai/cutout/item`.
