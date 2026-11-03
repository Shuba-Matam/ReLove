# AI budget status

The hard-budget migration is already applied. This file records the active release contract; it is not a migration proposal and contains no SQL to apply.

- Provider: Meta for draft, voice, and cutout. Baseten compatibility remains disabled for this release and must not use coding-agent credits.
- Approved total cap: `100000` microUSD ($0.10).
- Feature reservation: `10000` microUSD for each draft, transcription, or cutout attempt.
- Limits: 10 attempts per UTC day and 10 per user per UTC day for the owner-only activation window.
- Metering: every provider attempt, including a failure or timeout, requires an atomic reservation through the privileged server-only metering client. Duplicate completed operations return their validated cached result without another provider attempt.
- Safety gates: `AI_ENABLED`, feature settings, pricebook rows, authentication, CSRF checks, owner test allowlist, provider/model allowlists, and trusted input/output bounds all remain mandatory and fail closed.

Activation changes only existing environment and database settings. Do not add schema, raise the approved cap, loosen parsing, bypass metering, or enable retries during owner-only smoke testing. See `docs/PHASE-2-AI.md` for the release checklist.
