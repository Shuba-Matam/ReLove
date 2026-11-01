# Re-Love database migration handoff

The owner approved the agreed schema on November 1, 2026. The sole Muse release integrator owns comparison against that scope, remote application and deployment. This worktree has only executed migrations locally in PGlite; it has not applied remote schema changes.

Apply 001_initial.sql then 002_ai.sql to the existing Supabase project after scope review. The migrations assume Supabase-provided auth.users, auth.uid(), storage.buckets, storage.objects, the anon/authenticated roles, and the storage.foldername helper. They do not create auth/storage stubs or require optional extensions. Test-only stubs are in tests/database.test.ts.

The first migration contains profiles, categories, listings, threads, messages and reports; eight category seeds; signup profile creation/backfill; search trigger and indexes; column grants and RLS; own-folder image storage with a 2MiB bucket limit; immutable source objects; image existence and ownership validation; and a deterministic prohibited-keyword hold. Listing deletion cascades conversations/messages/reports. Images remain public by URL even when a listing is hidden. The feed shows active listings; sold detail pages remain readable. Source and derived cutout_path references prevent deleting an image in use.

The second migration contains ai_budget, ai_settings and ai_usage. All are initially disabled. Global50/user5 budgets count all features, attempts, failures and pending work per UTC day. One locked budget row serializes reservations. Only authenticated callers can reserve, and server inputs cannot raise database hard caps. No provider request occurs until both server and database switches permit it.

Set APP_MODE=live and GOOGLE_AUTH_ENABLED=true after the approved schema and Google callback configuration are ready. Keep AI_ENABLED=false. Normal app requests use SUPABASE_PUBLISHABLE_KEY with the user's verified session and RLS; no service-role key is needed by the app.

Deleting/replacing a listing attempts source and cutout cleanup after the database mutation. Transient failures leave an owned orphan, recoverable through DELETE /api/uploads after reference checks. Account deletion and operator moderation are not self-service UI features.

Validation: npm test runs real migration/RLS tests locally using independent seller, buyer and stranger identities, plus input/auth/AI failure drills. Live OAuth/storage and provider smoke tests remain release steps.
