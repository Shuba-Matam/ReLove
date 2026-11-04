# AI budget status

The hard-budget migration is already applied. This file records the active release contract; it is not a migration proposal and contains no SQL to apply.

- Provider: Meta for draft, voice, and cutout. Baseten compatibility remains disabled for this release and must not use coding-agent credits.
- Conservative Meta cap: `600000` microUSD ($0.60 app reservation ceiling).
- Feature reservation: `10000` microUSD for each draft, transcription, or cutout attempt.
- Limits: 60 attempts per UTC day shared across accounts, 20 per ordinary authenticated user, and 50 for an authenticated email/ID in `AI_OWNER_ALLOWLIST` when `AI_OWNER_DAILY_LIMIT=50`.
- Metering: every provider attempt, including a failure or timeout, requires an atomic reservation through the privileged server-only metering client. Duplicate completed operations return their validated cached result without another provider attempt.
- Safety gates: `AI_ENABLED`, feature settings, pricebook rows, authentication, CSRF checks, provider/model allowlists, and trusted input/output bounds remain mandatory and fail closed. `AI_OWNER_ALLOWLIST` classifies the authenticated owner for the higher cap when test mode is off.

Activation changes only existing environment and database settings. The database global and feature `per_user_limit` remain the hard ceiling (50); the trusted server supplies the ordinary 20 or owner 50 limit to the service-role-only reservation RPC. Do not reset usage, add schema, loosen parsing, bypass metering, or enable retries during activation. See `docs/PHASE-2-AI.md` for the release checklist.
