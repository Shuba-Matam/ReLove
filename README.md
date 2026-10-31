# Re-Love

A student marketplace for giving pre-loved items a new home.

## Status

Phase 0: account setup and a public Next.js landing page for Google OAuth branding.
This repository preserves the original local commit history and subsequent work.

Supabase connectivity is verified. The existing Vercel project `re-love` is linked
to this repository's `main` branch and has its server environment variables.
Google OAuth is configured in Supabase, email/password sign-in is disabled, and
the authorization redirect to Google has been checked. Full sign-in testing awaits
the application and callback route. Google audience/publishing status and account
billing plans have not been verified. No application schema has been created.
The public homepage and `/privacy` describe the current preview; marketplace features
and public sign-in are not yet implemented.

The production domain is `re-love-pi.vercel.app`. The authorized application
callback routes are `/auth/callback` on that domain and on `http://localhost:3000`.
Google's OAuth redirect URI points to the Supabase project's `/auth/v1/callback`.

## Planned stack

Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase
(Postgres, Auth, Storage, and row-level security), and Vercel.

## Local development

Use Node.js 22 or newer. Run `npm ci`, copy `.env.example` to `.env.local` and
provide values privately, then run `npm run dev`. The public preview needs no
credentials to render. Run `npm run lint`, `npm run typecheck`, and `npm run build`
before deploying. Google client credentials configure hosted Supabase Auth and
are not included in browser code.

## Confirmed decisions

- Google sign-in only; any Google account may register for now.
- Free plans requested for Supabase and Vercel. Reuse the owner's existing
  Supabase project in Tokyo (`ap-northeast-1`); organization billing is not yet verified.
- Original listing photos are the source of truth. Sellers confirm all AI suggestions.
- AI must never invent brand, edition, price, or condition.
- Keys remain in server environment variables, never `NEXT_PUBLIC` variables.
- Local credentials belong in the gitignored `.env.local`; never paste them into chat.
- Validate inputs with Zod. Every AI route requires authentication, a kill switch,
  daily and per-user limits, timeouts, at most two retries, and a manual fallback.
- Work one step at a time. Obtain the owner's approval before changing the schema.

## Roadmap

1. Deploy a walking skeleton that reads categories from the database.
2. Build listings, browsing, search, profiles, and private messaging.
3. Add optional AI listing drafts, voice input, and image cutouts.
4. Test authorization and failure handling, polish, and prepare the demo.
