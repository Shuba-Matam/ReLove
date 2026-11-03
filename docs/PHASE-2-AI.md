# Phase 2 AI activation

Phase 2 AI is implemented for listing drafts, voice transcription, and listing-photo cutouts. No schema change is required for this release. Production remains off until the existing environment and database feature gates are enabled by the release owner.

## Current provider contracts

- Drafts use Meta `POST /v1/chat/completions` with the allowlisted `muse-spark-1.3` model, an optional seller transcript, and at most one owned inline image. Requests use `max_completion_tokens: 1200` and `reasoning_effort: "minimal"`; the same 1,200-token ceiling is included in the cost preflight. Plain-text JSON is strictly validated and seller-sensitive fields remain unset.
- Voice uses Meta `POST /v1/asr/transcribe` with `muse-voice-transcribe-1.0`. Input is mono 16-bit PCM WAV at 16 or 24 kHz, at most 60 seconds and 3 MB. Only the validated transcript reaches the browser.
- Cutouts use Meta `POST /v1/responses` with `sam-3.1`, an owned inline original image, a bounded noun-phrase prompt, and one-bit masks. Invalid, ambiguous, tiny, near-full-frame, or fragmented masks leave the original unchanged.

All calls use fixed endpoints and server-only credentials. They require authentication, same-origin mutation checks, the global kill switch, owner allowlisting while test mode is active, enabled pricebook rows, and atomic budget reservation. Failures count. Test mode forces zero retries.

## Activation checklist

1. Keep `AI_DRAFT_PROVIDER=meta` and `META_MODEL=muse-spark-1.3`; configure `META_API_KEY` only in the server environment.
2. Confirm the existing database budget is enabled with the approved total cap, per-feature reservations, pricebook rows, and daily/per-user limits. Do not add or modify schema for activation.
3. Keep `AI_TEST_MODE=true` and an exact owner email or user ID in `AI_OWNER_ALLOWLIST` for the first production smoke tests.
4. Set `AI_ENABLED=true` only when the release owner is ready to run capped tests. Restart or redeploy so server runtime configuration is refreshed.
5. Through the normal authenticated routes, verify one owner photo draft, one short voice clip, and one owner listing cutout. Confirm manual fallback, seller review, original-photo preservation, and no automatic publication.
6. After verification, either keep owner-only test mode for a limited rollout or disable test mode only with explicit owner approval. Leave budget, authentication, CSRF, parsing, and output bounds in place.

The local smoke helper calls the authenticated draft route and prints only status, suggested field names, and an error code. Use `localhost` consistently for both the app origin and request origin. Never print or commit session cookies, access tokens, image paths, transcripts, or provider keys.

## Deferred scope

Multi-item extraction from one image, video, background queues, search/message AI, automatic publication, and push notifications are not part of this activation.
