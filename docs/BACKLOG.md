# Deferred work

## Closed-app push notifications — deferred November 4, 2026

Owner requested postponement while Phase 2 AI features are brought live.

- Preserve the existing push implementation in branch `t3/build-working-backbone-1`; do not integrate or deploy it in the AI release.
- Later: finish subscription and logout handling, durable delivery, service-worker validation, and remaining database tests.
- Review the concrete push migration before requesting schema approval, then configure delivery credentials and test on real devices.
- Existing in-app alerts remain available. Email notifications remain out of scope.

## Multiple cutouts from one photo — later phase

- Current cutout flow intentionally accepts exactly one clear mask and produces one derived listing image.
- Multi-item extraction, choosing among several detected objects, and publishing multiple cutouts from one original are not implemented in this change.
