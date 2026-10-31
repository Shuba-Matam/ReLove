# Re-Love

A student marketplace for giving pre-loved items a new home.

## Status

Phase 0: repository and account setup. Application implementation has not started.
This repository preserves the original local commit history and subsequent work.

## Planned stack

Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase
(Postgres, Auth, Storage, and row-level security), and Vercel.

## Confirmed decisions

- Google sign-in only; any Google account may register for now.
- Free Supabase and Vercel plans; Mumbai database region if available.
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
