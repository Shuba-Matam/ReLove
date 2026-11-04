# Re-Love

A student marketplace for giving pre-loved items a new home. Built with Next.js App Router, TypeScript, Tailwind CSS, shadcn-style components, and Supabase Auth/Postgres/Storage.

## What is implemented

- Responsive dark marketplace, 2-column mobile and 4-column desktop feed, search, category/price/condition/hostel filters, and load-more.
- Google-only login, profiles, listing create/edit/sold/delete, image upload, seller confirmation, and original-photo display.
- Private per-listing conversations with optimistic idempotent sending, live incoming messages and read receipts, realtime unread counts, earlier-message loading, and insert-only reports.
- In-app new-message toasts and realtime unread bell badges while the app is open. Closed-app browser push is not part of this release.
- Reviewable database migrations with RLS, column privileges, full-text indexing, category seeds, own-folder storage, and atomic AI usage budgets.
- Explicit editable listing suggestions with missing-detail and photo feedback (Meta Muse Spark 1.3), WAV voice transcription (Meta Muse Voice Transcribe 1.0), and single- or multi-item SAM 3.1 cutouts. All AI features are disabled by default and require server credentials, pricebook entries, and database limits.
- One uploaded source photo can be manually boxed into up to three item cutouts and then published as separate listings. There is no automatic object discovery and no requirement to upload three photos.
- Explicit read-only sample mode, PWA manifest/icons/offline notice, accessible forms/focus handling, and the preserved /privacy route.

## Status and boundaries

The current release is deployed at [re-love-pi.vercel.app](https://re-love-pi.vercel.app). Supabase migrations through `005_messaging_notifications.sql` are applied, and commit `20880c6eecc90fe2ec588f113d667c01b9d9a2f6` was deployed on November 5, 2026. The production deployment has Google login and the configured Meta AI features enabled.

Repository defaults remain conservative: AI features fail closed unless credentials, feature settings, pricebook rows, and database budgets are available, and Google login requires the readiness flag plus provider configuration. Deployments manage their own environment settings and schema application; the repository does not apply remote changes or deploy itself.

## Current scope

- Notifications are in-app while Re-Love is open; closed-app push is not included.
- Multi-item cutouts require manual box marking for up to three items; automatic object discovery is not included.
- Signed-in users can edit their profile, but self-service account deletion is not implemented.

## Run locally

Use Node 22 (tested with 22.14.0) and npm 11.21.1. npm 10.9.2 on this Windows machine hit an Arborist edgesOut resolver error; invoking npm 11 avoids it.

~~~sh
npx --yes npm@11.21.1 ci
cp .env.example .env.local
npm run dev
~~~

PowerShell can use Copy-Item .env.example .env.local instead of cp. Do not overwrite an existing credential file. APP_MODE=demo runs the read-only sample marketplace without contacting Supabase or AI providers. The twenty fictional listing records use original SVG illustrations; they are not real listings or photos supplied by sellers.

To connect the actual marketplace, apply the SQL files in order through the deployment workflow, set APP_MODE=live, configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the deployment, and enable the Google readiness flag. Supabase redirect allowlists must include the deployment's /auth/callback path and localhost during development. The Google OAuth client redirects to the Supabase Auth callback, not directly to the app.

## Server environment

| Variable | Purpose |
| --- | --- |
| APP_MODE | demo (read only), live (database), or setup (unavailable) |
| SUPABASE_URL | Supabase project origin |
| SUPABASE_PUBLISHABLE_KEY | Supabase public app key used by server routes and the authenticated browser realtime bootstrap, with RLS enforcing access |
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
| SUPABASE_SERVICE_ROLE_KEY | Server-only access for the existing AI budget ledger |

Secrets remain server-side. The authenticated realtime bootstrap returns only the current verified user's short-lived access token, expiry, Supabase URL, and public key. The access token stays in memory and is renewed through the same authenticated route before expiry. The HTTP-only refresh credential is never returned to JavaScript. RLS scopes Postgres Changes, and disconnect clears the browser client immediately. No service role reaches the browser. Google client secret belongs in Supabase's provider configuration, not the frontend. Development coding agents and their credentials are separate from the models called by the running Re-Love app.

`supabase/migrations-draft/005_messaging_notifications.sql` adds in-app messaging support: action idempotency, inbox/read RPCs, supporting indexes, and Supabase Realtime publication. No VAPID keys, notification permission, scheduler, or external push service is required.

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
# optional dependency review
npm audit --omit=dev
~~~

The November 5, 2026 release evidence records 240 application tests, 68 release checks, and 33 targeted timestamp follow-up tests, along with successful typecheck, build, CI, deployment, and live smoke checks. Live verification covered message sending, incoming messages without refresh, read receipts, unread counts and notifications, duplicate handling, inbox behavior, and conversation isolation.

Browser checks covered desktop and mobile viewport sizes; this is not a physical-device or comprehensive photo-quality benchmark.
