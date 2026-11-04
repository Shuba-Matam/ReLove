# Re-Love

A student marketplace for giving pre-loved items a new home. Built with Next.js App Router, TypeScript, Tailwind CSS, shadcn-style components, and Supabase Auth/Postgres/Storage.

## What is implemented

- Responsive dark marketplace, 2-column mobile and 4-column desktop feed, search, category/price/condition/hostel filters, and load-more.
- Google-only login, profiles, listing create/edit/sold/delete, image upload, seller confirmation, and original-photo display.
- Private per-listing conversations, unread counts, focus refresh, earlier-message loading, and insert-only reports.
- Reviewable database migrations with RLS, column privileges, full-text indexing, category seeds, own-folder storage, and atomic AI usage budgets.
- Explicit editable listing suggestions with missing-detail and photo feedback (Meta Muse Spark 1.3), WAV voice transcription (Meta Muse Voice Transcribe 1.0), and single- or multi-item SAM 3.1 cutouts. All AI features are disabled by default and require server credentials, pricebook entries, and database limits.
- One uploaded source photo can be manually boxed into up to three item cutouts and then published as separate listings. There is no automatic object discovery and no requirement to upload three photos.
- Explicit read-only sample mode, PWA manifest/icons/offline notice, accessible forms/focus handling, and the preserved /privacy route.

## Status and boundaries

The application includes the live marketplace flows, Google sign-in integration, Supabase-backed listings and conversations, image storage, optional AI assistance, demo mode, privacy information, and PWA assets. Production configuration and database state are operational concerns outside the repository, so source defaults remain conservative and AI stays fail-closed when credentials, settings, pricebook rows, or budgets are unavailable.

The deployed environment must set its own authentication, provider, and feature flags. Production read-only checks can verify configuration and availability without making provider calls, but real-account writes, provider outputs, and mobile behavior still require explicit release verification. This repository does not apply remote schema changes or deploy itself.

## Run locally

Use Node 22 (tested with 22.14.0) and npm 11.21.1. npm 10.9.2 on this Windows machine hit an Arborist edgesOut resolver error; invoking npm 11 avoids it.

~~~sh
npx --yes npm@11.21.1 ci
cp .env.example .env.local
npm run dev
~~~

PowerShell can use Copy-Item .env.example .env.local instead of cp. Do not overwrite an existing credential file. APP_MODE=demo runs the read-only sample marketplace without contacting Supabase or AI providers. The twenty fictional listing records use original SVG illustrations; they are not real listings or photos supplied by sellers.

To connect the actual marketplace, apply the approved SQL files in order through an authorized deployment workflow, set APP_MODE=live, configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the server, and enable the Google readiness flag. Supabase redirect allowlists must include the deployment's /auth/callback path and localhost during development. The Google OAuth client redirects to the Supabase Auth callback, not directly to the app.

## Server environment

| Variable | Purpose |
| --- | --- |
| APP_MODE | demo (read only), live (database), or setup (unavailable) |
| SUPABASE_URL | Supabase project origin |
| SUPABASE_PUBLISHABLE_KEY | Supabase app key, used only by server code with RLS |
| GOOGLE_AUTH_ENABLED | true once the Google provider and callback allowlist are ready |
| AI_ENABLED | Master switch; keep false until provider checks pass |
| AI_MULTI_CUTOUT_ENABLED | Independent server-side switch for the optional up-to-3 box-marking flow; defaults false |
| AI_DAILY_LIMIT | Global cap across features; the source fallback is 50 when unset, while production is configured for 60 |
| AI_USER_DAILY_LIMIT | Authenticated-user cap across features; the source fallback is 15 when unset, while production is configured for 20 |
| AI_OWNER_DAILY_LIMIT | Optional cap for an authenticated email/ID in `AI_OWNER_ALLOWLIST`; production is configured for 50, falls back to the regular cap when unset, and fails closed for that owner when invalid |
| AI_DRAFT_PROVIDER | Source default is `baseten` when unset; production must set `meta` explicitly to use the configured Meta route. There is no silent fallback after selection |
| META_MODEL | `muse-spark-1.3` for listing suggestions |
| META_API_KEY | Application credential for suggestions, voice, and SAM |
| BASETEN_API_KEY | Optional compatibility credential for Muse Spark Open, not the production default |
| BASETEN_MODEL | Optional compatibility model, defaults to meta-models/muse-spark-open-1026 |
| AI_MAX_RETRIES | Provider retries after the first attempt; production uses `0`, so one explicit action makes at most one provider attempt |

All values remain server-side; no NEXT_PUBLIC keys, service-role browser clients, or direct browser Supabase calls. Google client secret belongs in Supabase's provider configuration, not the frontend. Development coding agents and their credentials are separate from the models called by the running Re-Love app. No provider smoke test or live enablement is claimed by this repository update.

## Architecture

~~~mermaid
flowchart LR
  Browser[Browser / installed PWA] --> Next[Next.js server routes]
  Next --> Auth[Supabase Google Auth]
  Next --> DB[Postgres + RLS]
  Next --> Storage[Own-folder public image storage]
  Next --> Guard[Auth + kill switch + atomic budgets]
  Guard --> Meta[Muse Spark 1.3 + Voice Transcribe 1.0 + SAM 3.1 / Meta]
  Guard -. optional compatibility .-> Baseten[Muse Spark Open adapter / Baseten]
~~~

Source: src/lib/server for auth/data helpers, src/app/api for endpoints, src/lib/validation.ts for input contracts, src/lib/ai for guarded provider adapters. docs/IMPLEMENTATION-CONTRACT.md lists endpoints. SQL lives in supabase/migrations-draft; it is intentionally outside an automatically applied migrations folder.

## Data and authorization

Six core tables: profiles, categories, listings, threads, messages, reports. Active and sold listings plus safe profile columns are publicly readable; the feed displays active listings. Hidden listings are visible only to their owner. Mutation routes verify the session; RLS and explicit database grants protect against bypassing the app. Thread membership is bound to a listing's actual seller; only recipients can change read_at. Reports cannot be read by regular users. Deleting a listing cascades its threads, messages, and reports.

Photos are processed to at most 1600px, stored in listing-images under the uploader's user ID, and publicly readable by URL. Source files cannot be overwritten. Metadata is removed on re-encoding. Deleting or replacing a listing photo attempts cleanup of the source and derived cutout; failed cleanup leaves a recoverable orphan. Public images remain accessible by URL while a listing is hidden, as described in /privacy. Supabase already manages RLS and grants for its storage schema; migration tests use matching stubs only in the test harness.

Prices are whole INR amounts from 0 through 10000000. Conditions are new, like_new, good, fair. Local banned-keyword checks put a listing on hold; sellers cannot remove a moderation hold themselves. Administrative review remains an operator task in Supabase.

## AI behavior

Every provider attempt reserves capacity in the database before calling the provider. A single locked ai_budget row enforces global and per-user UTC-day caps across features; ai_settings can impose smaller feature caps. Those effective feature caps are compared with all global or account attempts, matching the atomic reservation function. Failed and pending attempts count. The code permits at most two configured retries and has a 20-second operation timeout, but production sets `AI_MAX_RETRIES=0`, so it does not make an automatic provider retry or JSON-repair call. ai_budget and all features initially remain disabled. Turning on only the environment switch does not bypass database controls.

Draft validation rejects extra keys such as price; brand, edition and condition guesses are explicitly nulled. AI runs only when the seller clicks **Generate Suggestions**. Every intentional click is a new generation and fills title, description, category, and tags directly; those fields remain editable. Price, condition, and location remain seller-entered. A failed or stale response does not erase the form. The same bounded response may offer optional short missing-detail questions and photo guidance. It does not block publication or invent defects.

The UI reports shared account AI tries remaining from the authenticated usage ledger, alongside availability for the feature being shown. These are app attempts, including pending and failed reservations, not Meta credits, provider tokens, or billing balances. Cache hits do not add an attempt. Shared, feature, global, and provider-budget gates can still make a feature unavailable before an account reaches a looser environment cap. The client refreshes after draft, voice, and cutout attempts, on focus or visibility return, and just after the UTC day boundary. It hides stale values during account changes and hides values when the read cannot be verified.

Transcription accepts mono PCM WAV; the browser converts its recording and limits recording to one minute. SAM checks foreground size, near-full-frame masks, fragmentation, and ambiguous multiple matches, then places the cutout over a plain background without altering the original.

Cutouts are explicit pre-publication actions. The single-item flow uses a seller-entered object prompt. The multi-item flow keeps the shared original, lets the seller draw, edit, redraw, or remove up to three boxes, creates cutouts independently, and opens one listing form per successful item. Editing one box invalidates only that item. There is no automatic discovery, autonomous agent loop, or durable background job queue. Semantic AI moderation is reserved in the budget schema but not wired to publication; the deterministic keyword hold and reports work without AI.

The configured production routes use `muse-spark-1.3` for listing suggestions, `muse-voice-transcribe-1.0` for voice transcription, and `sam-3.1` for cutouts. The optional Baseten compatibility adapter uses `meta-models/muse-spark-open-1026`. Source code defaults an unset `AI_DRAFT_PROVIDER` to Baseten for compatibility, while production explicitly selects Meta. Provider output is treated as untrusted text or JSON and validated before use. Provider references: https://dev.meta.ai/docs/cookbook/quickstart-chat-completions ; https://dev.meta.ai/docs/api-reference/voice/transcribe ; https://dev.meta.ai/docs/sam/client-libraries ; https://docs.baseten.co/inference/model-apis/overview .

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
