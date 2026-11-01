# Shared implementation contract

All browser access to Supabase passes through same-origin server routes. No keys or Supabase browser client. Client imports types/constants from `@/lib/marketplace` and validation from `@/lib/validation`.

API success: `{ data, mode: "demo" | "live" | "setup", meta?: { next_cursor, total } }`. Errors: `{ error: { code, message, fields? } }`. Demo is explicitly labelled, read only, and uses original local illustrations. Live database failures never silently become sample listings. All API responses are no-store.

Endpoints:

- `GET /api/session` -> SessionInfo. `GET /auth/login?next=/sell` starts Google OAuth; `GET /auth/callback` exchanges the code; `POST /auth/logout` signs out.
- `GET /api/categories` -> Category[]. `GET /api/listings` -> Listing[] + pagination meta. Query: q, category (slug), condition, hostel_block, min_price, max_price, sort (newest/price_asc/price_desc), cursor (offset), limit.
- `GET /api/listings/:id` -> Listing. `POST /api/listings` accepts ListingInput; returns Listing. `PATCH /api/listings/:id` accepts listingUpdateSchema; returns Listing. `DELETE /api/listings/:id` -> `{ deleted: true }`.
- `POST /api/uploads` multipart `file` -> `{ path, url }`. `DELETE /api/uploads` JSON `{ path }` deletes an owned unreferenced upload. Browser compresses to JPEG at most 1600px and 500KB. Original compressed image always preserved as the listing source. Create/update sends image_path; server derives URL.
- `GET /api/my-listings?status=active|sold|hidden` -> Listing[]. `PATCH /api/profile` -> Profile.
- `GET /api/threads` -> ThreadSummary[]. `POST /api/threads` `{ listing_id }` -> `{ id }` (idempotent per buyer/listing).
- `GET /api/threads/:id` -> ThreadDetail; `POST /api/threads/:id/messages` `{ body }` -> Message; `POST /api/threads/:id/read` marks received messages read -> `{ updated: true }`. Refresh on window focus, no realtime.
- `POST /api/reports` reportSchema -> `{ submitted: true }`.
- `GET /api/health` -> non-secret status, readiness. 503 for unavailable live schema.
- `POST /api/ai/draft` `{ image_path?, transcript? }` -> `{ draft, suggested_fields }`. Draft nullable fields: title, category_slug, description, condition_hint, brand, edition; tags array. No price suggestions. 401/429/503 return manual fallback message.
- `POST /api/ai/transcribe` multipart `file` -> `{ transcript }`. This may return unavailable until a verified provider is configured; text entry always works.
- `POST /api/ai/cutout` `{ listing_id }` -> `{ status }`. Optional and off until provider ready.

Backend shared exports for parent AI routes: `@/lib/server/supabase` exports async `createSupabaseServerClient()` (null if no config); `@/lib/server/http` exports `ApiProblem(status, code, message)`, `withApi(handler)` wrapper, `json(data, status?, meta?)`, `readJson(request, schema)`, `assertSameOrigin(request)`; `@/lib/server/auth` exports `requireUser()` -> `{ supabase, user }` with user.id. Adjustments must be communicated before integration.

SQL is a REVIEW DRAFT, never applied remotely without owner approval. Tables: profiles, categories, listings, threads, messages, reports; storage bucket listing-images with own-folder writes; AI usage/settings + reserve_ai_usage(p_feature,p_daily_limit,p_user_limit) returns `{allowed:boolean,usage_id:uuid|null,reason:text|null}` (one row). DB settings are hard upper caps; defaults disabled. complete_ai_usage(p_usage_id,p_ok,p_ms) only touches caller's reservation. Counters must be atomic across concurrent requests and count provider attempts, including retries. AI credentials are not prerequisites for base marketplace.
