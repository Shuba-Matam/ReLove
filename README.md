# Re-Love

A student marketplace for giving pre-loved items a new home. Built with Next.js App Router, TypeScript, Tailwind CSS, shadcn-style components, and Supabase Auth/Postgres/Storage. The original repository history is preserved.

## What is implemented

- Responsive dark marketplace, 2-column mobile and 4-column desktop feed, search, category/price/condition/hostel filters, and load-more.
- Google-only login, profiles, listing create/edit/sold/delete, image upload, seller confirmation, and original-photo display.
- Private per-listing conversations, unread counts, focus refresh, earlier-message loading, and insert-only reports.
- Reviewable database migrations with RLS, column privileges, full-text indexing, category seeds, own-folder storage, and atomic AI usage budgets.
- Optional photo drafts (Muse Spark Open via Baseten), WAV voice transcription (Muse Voice Transcribe via Meta), and owner-requested SAM cutouts. Credentials and smoke validation are still required. All are disabled by default.
- Explicit read-only sample mode, PWA manifest/icons/offline notice, accessible forms/focus handling, and the preserved /privacy route.

## Status and boundaries

The complete local build is ready for integration. The owner approved the agreed schema on November 1, 2026; the primary coordinating thread owns remote scope review, migration application, credentials, and deployment. This worktree has not changed the remote database or deployed the marketplace.

The main branch already has a public branding/privacy preview. Preserve its canonical domain, privacy URL, and repository history when integrating this application. Do not merge or push a second competing deployment from a side worktree.

Google OAuth configuration and production audience were confirmed in the primary thread. Set GOOGLE_AUTH_ENABLED=true only on the connected deployment. Real two-account OAuth, database, storage, mobile and provider checks remain release checks after migration application.

## Run locally

Use Node 22 (tested with 22.14.0) and npm 11.21.1. npm 10.9.2 on this Windows machine hit an Arborist edgesOut resolver error; invoking npm 11 avoids it.

~~~sh
npx --yes npm@11.21.1 ci
cp .env.example .env.local
npm run dev
~~~

PowerShell can use Copy-Item .env.example .env.local instead of cp. Do not overwrite an existing credential file. APP_MODE=demo runs the read-only sample marketplace without contacting Supabase or AI providers. The twenty fictional listing records use original SVG illustrations; they are not real listings or photos supplied by sellers.

To connect the actual marketplace, apply the approved SQL files in order using the primary thread's authorized deployment workflow, set APP_MODE=live, configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the server, and enable the Google readiness flag. Supabase redirect allowlists must include the deployment's /auth/callback path and localhost during development. The Google OAuth client redirects to the Supabase Auth callback, not directly to the app.

## Server environment

| Variable | Purpose |
| --- | --- |
| APP_MODE | demo (read only), live (database), or setup (unavailable) |
| SUPABASE_URL | Supabase project origin |
| SUPABASE_PUBLISHABLE_KEY | Supabase app key, used only by server code with RLS |
| GOOGLE_AUTH_ENABLED | true once the Google provider and callback allowlist are ready |
| AI_ENABLED | Master switch; keep false until provider checks pass |
| AI_MULTI_CUTOUT_ENABLED | Independent server-side switch for the optional up-to-3 box-marking flow; defaults false |
| AI_DAILY_LIMIT | Global cap across features, defaults to 50 |
| AI_USER_DAILY_LIMIT | Authenticated-user cap across features, defaults to 15 |
| AI_OWNER_DAILY_LIMIT | Optional cap for an authenticated email/ID in `AI_OWNER_ALLOWLIST`; falls back to the regular cap when unset and fails closed for that owner when invalid |
| BASETEN_API_KEY | Application credential for photo drafts |
| BASETEN_MODEL | Defaults to meta-models/muse-spark-open-1026; verify availability in the app account |
| META_API_KEY | Application credential for voice and SAM |

All values remain server-side; no NEXT_PUBLIC keys, service-role browser clients, or direct browser Supabase calls. Google client secret belongs in Supabase's provider configuration, not the frontend. Credentials used by Muse coding agents in T3 do **not** configure the app: the application needs its own BASETEN_API_KEY and META_API_KEY. Neither app provider was smoke-tested or enabled in this worktree.

## Architecture

~~~mermaid
flowchart LR
  Browser[Browser / installed PWA] --> Next[Next.js server routes]
  Next --> Auth[Supabase Google Auth]
  Next --> DB[Postgres + RLS]
  Next --> Storage[Own-folder public image storage]
  Next --> Guard[Auth + kill switch + atomic budgets]
  Guard --> Baseten[Muse Spark Open / Baseten]
  Guard --> Meta[Voice Transcribe + SAM / Meta]
~~~

Source: src/lib/server for auth/data helpers, src/app/api for endpoints, src/lib/validation.ts for input contracts, src/lib/ai for guarded provider adapters. docs/IMPLEMENTATION-CONTRACT.md lists endpoints. SQL lives in supabase/migrations-draft; it is intentionally outside an automatically applied migrations folder.

## Data and authorization

Six core tables: profiles, categories, listings, threads, messages, reports. Active and sold listings plus safe profile columns are publicly readable; the feed displays active listings. Hidden listings are visible only to their owner. Mutation routes verify the session; RLS and explicit database grants protect against bypassing the app. Thread membership is bound to a listing's actual seller; only recipients can change read_at. Reports cannot be read by regular users. Deleting a listing cascades its threads, messages, and reports.

Photos are processed to at most 1600px, stored in listing-images under the uploader's user ID, and publicly readable by URL. Source files cannot be overwritten. Metadata is removed on re-encoding. Deleting or replacing a listing photo attempts cleanup of the source and derived cutout; failed cleanup leaves a recoverable orphan. Public images remain accessible by URL while a listing is hidden, as described in /privacy. Supabase already manages RLS and grants for its storage schema; migration tests use matching stubs only in the test harness.

Prices are whole INR amounts from 0 through 10000000. Conditions are new, like_new, good, fair. Local banned-keyword checks put a listing on hold; sellers cannot remove a moderation hold themselves. Administrative review remains an operator task in Supabase.

## AI behavior

Every provider attempt reserves capacity in the database before calling the provider. A single locked ai_budget row enforces global and per-user UTC-day caps across features; ai_settings can impose smaller feature caps. Failed and pending attempts count. Retries are at most two, draft JSON repair at most one, and the operation timeout is 20 seconds. ai_budget and all features initially remain disabled. Turning on only the environment switch does not bypass database controls.

Draft validation rejects extra keys such as price; brand, edition and condition guesses are explicitly nulled. Suggestions are optional and editable; the seller must set price/condition and confirm before publishing. No automatic publish. Transcription accepts mono PCM WAV; the browser converts its recording and limits recording to one minute. SAM checks foreground size, near-full-frame masks, fragmentation, and ambiguous multiple matches, then places the cutout over a plain background without altering the original.

The cutout is an explicit owner action after publishing and runs in a bounded request. There is no durable background job queue or automatic after-publish cutout yet. Semantic AI moderation is reserved in the budget schema but not wired to publication; the deterministic keyword hold and reports work without AI. Multi-item draft extraction and Muse Image are not implemented.

Baseten's current official docs do not advertise structured JSON mode for Muse Spark Open, so this app requests text JSON and validates it itself. The named model slug must be verified with the app's own account. Provider references: https://docs.baseten.co/inference/model-apis/overview ; https://dev.meta.ai/docs/api-reference/voice/transcribe ; https://dev.meta.ai/docs/sam/client-libraries .

## Validation

~~~sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
~~~

Tests execute the actual migrations in PGlite with three independent user identities and Supabase auth/storage stubs. They exercise hidden listing privacy, unauthorized writes, source image rules, full-text tags, message isolation/read receipts, reports, and AI caps. Additional tests cover malformed drafts, invalid input, redirects/CSRF, timeouts, retry bounds, kill switch, and mask validation.

A production HTTP pass checks demo filters/pagination, source detail, clear missing-listing state, session, mutation rejection, privacy/PWA assets, and live schema-unavailable errors. No browser visual test or real phone test is claimed. Next.js may stream a missing page with HTTP 200 plus its not-found view; the data endpoint correctly returns 404.

The production dependency audit passes with zero known vulnerabilities. The development lint toolchain still inherits a moderate minimatch advisory; no forced major override was used because its call contract differs between dependencies.

For provider smoke testing, use a real owned upload and an authenticated test account. Set SMOKE_SESSION_COOKIE privately and run npm run smoke:ai -- <owned-upload-path>; this goes through the normal app guard and reports only status and suggested field names. Run ten owner-supplied original photos, including hard cases, then English/Tamil/mixed recordings and the failure checklist. The app is usable manually while AI is disabled.

## Still to verify before release

Approved migrations on Supabase, actual two-account Google sign-in and RLS/storage checks, same-site cookies on the live domain, the real-phone layouts and PWA install flow, provider access and ten-photo results, final privacy review, and owner-supplied seed photos. Do not pass illustrations off as seller photographs. A signed-in user can edit their profile; self-service account deletion is not implemented. The public GitHub issues page is the approved contact for requesting a private follow-up, not a place for private data.
