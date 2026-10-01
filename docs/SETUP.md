# Setup

From an empty Supabase project to a first pilot run. Everything targets free tiers first; TypeSafe Jev is the one paid AI service (well under a cent per ad).

## 1. Accounts and keys

| Service | Plan | What you need |
| --- | --- | --- |
| Supabase | Free | A project: Project URL, anon (publishable) key, service_role key |
| Vercel | Hobby (non-commercial; move to Pro if this becomes a Wasal tool) | A project for `apps/web` |
| Apify | Free monthly credit | API token |
| Groq | Free tier | API key (transcription) |
| Google AI Studio | Gemini free tier | API key (vision pass, brief writing) |
| TypeSafe | Paid, no free tier | API key (Jev classification) |
| Anthropic | Optional | API key, only if `VISION_PROVIDER` or `BRIEF_PROVIDER` is `claude` |

Gemini's free tier may use prompts to improve Google's models. That is fine for public ads; never send Wasal's own ad data (Phase 3) through it.

## 2. Database

1. Create the Supabase project (Postgres 15 or later; new projects already are).
2. Apply the migrations in order, either with the Supabase CLI (`supabase link`, then `supabase db push`) or by pasting each file from `supabase/migrations/` into the SQL editor:
   - `20261001000000_init.sql`: tables, RLS, the private `frames` bucket, Realtime.
   - `20261001000100_first_sweep_watchlists.sql`: the first sweep watchlists.
3. Add yourself to the allowlist (only listed emails can see any data):

   ```sql
   insert into public.team_members (email) values ('you@example.com');
   ```

4. Authentication > URL Configuration:
   - **Site URL**: your dashboard URL, for example `https://content-lab-iota.vercel.app`. New projects default to `http://localhost:3000`, which sends magic links to your own computer.
   - **Redirect URLs**: `https://content-lab-iota.vercel.app/auth/callback`, `https://*-mr7d8s-projects.vercel.app/auth/callback` (previews) and `http://localhost:3000/auth/callback` (local work). Supabase only honours redirects on this list; anything else falls back to the Site URL.

   Email magic links are on by default.

To check the SQL itself on a throwaway local Postgres: `DATABASE_URL=postgres://... pnpm db:check` (19 checks). After changing a migration, regenerate types with `pnpm db:types` (or `supabase gen types typescript`).

## 3. Environment

Copy `.env.example` to `.env` (worker and scripts) and to `apps/web/.env.local` (dashboard), then fill in the keys. The dashboard only needs the public Supabase values plus `APIFY_TOKEN` and `APIFY_WORKER_ACTOR_ID` to start runs; the service_role key never goes into the dashboard.

```sh
pnpm install
pnpm run doctor            # presence checks, no network
pnpm run doctor --online   # also checks each key against its provider (free calls only)
```

## 4. Worker on Apify

The worker is an Apify actor in `apps/worker`. Its `.actor/actor.json` builds from the repository root so the shared `packages/core` is included.

1. Install the CLI and log in: `npm i -g apify-cli`, then `apify login`.
2. From `apps/worker`, run `apify push`. Alternatively, in the Apify console create an actor from this Git repository with the folder set to `apps/worker`.
3. In the actor's settings, add environment variables (mark keys as secret): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `TYPESAFE_API_KEY`, and optionally `GEMINI_MODEL`, `JEV_MODEL`, `VISION_PROVIDER`, `APIFY_CREATIVE_CENTER_ACTOR_ID`, `GROQ_REQUESTS_PER_MINUTE`, `GEMINI_REQUESTS_PER_MINUTE`. Apify injects `APIFY_TOKEN` itself.
4. Put the actor id (for example `yourname~content-lab-worker`) in the dashboard's `APIFY_WORKER_ACTOR_ID`.

Locally, the same pipeline runs with `pnpm worker:dev --run <run id>` (needs FFmpeg).

## 5. Dashboard on Vercel

Create a Vercel project from this repository with the root directory `apps/web` (framework: Next.js). Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APIFY_TOKEN` and `APIFY_WORKER_ACTOR_ID`, and optionally `NEXT_PUBLIC_SITE_URL` for magic link redirects. Locally: `pnpm dev`.

## 6. First pilot

1. Open `/demo` to see the animated views on synthetic data (no keys needed).
2. Sign in, open **Collect**, paste three TikTok video links, keep the suggested spend cap, and start.
3. Follow the run on **Live**. Each item goes fetch, extract, transcribe, vision, classify.
4. Check the results in **Library** and correct any label that is wrong; corrections are kept next to the model output.
5. Then do the 10 hand-picked strong ads from the plan's checklist to judge label quality before any scraping.

## Known limits in Phase 1

- **Creative Center links** need an Apify actor to be picked and checked on one URL (`APIFY_CREATIVE_CENTER_ACTOR_ID`). Until then they are flagged for review with that message. TikTok video links work through `clockworks/tiktok-scraper`.
- **Field names** of the TikTok scraper output and the Jev request shape follow their documentation and Creator Lab's working client; confirm both on the first pilot.
- **Percentiles** on the performance map are ranked within each source from its primary metric (views for organic, CTR for Creative Center) until the Phase 2 scoring step fills `scores`.
- **Watchlists** are stored but collected by hand for now; scheduled sweeps come in Phase 2.

## Development

```sh
pnpm test        # Vitest: core, worker (generated FFmpeg clips, no paid calls), web
pnpm typecheck
pnpm build
pnpm db:check    # migrations and RLS checks on a throwaway Postgres
```
