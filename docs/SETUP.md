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
   - `20261002000000_research_mode.sql`: research mode (watchlist schedule columns, `app_settings` with the monthly cap, `month_spend_usd()`).
   - `20261002000100_close_functions_to_anon.sql`: signed-out visitors cannot call the app's functions.
3. Add yourself to the allowlist (only listed emails can see any data):

   ```sql
   insert into public.team_members (email) values ('you@example.com');
   ```

4. Authentication > URL Configuration:
   - **Site URL**: your dashboard URL, for example `https://content-lab-iota.vercel.app`. New projects default to `http://localhost:3000`, which sends magic links to your own computer.
   - **Redirect URLs**: `https://content-lab-iota.vercel.app/auth/callback`, `https://*-mr7d8s-projects.vercel.app/auth/callback` (previews) and `http://localhost:3000/auth/callback` (local work). Supabase only honours redirects on this list; anything else falls back to the Site URL.

   Email magic links are on by default.

To check the SQL itself on a throwaway local Postgres: `DATABASE_URL=postgres://... pnpm db:check` (23 checks). After changing a migration, regenerate types with `pnpm db:types` (or `supabase gen types typescript`).

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
2. From `apps/worker`, run `apify push`. Alternatively, in the Apify console create an actor with the source type **Git repository** and this Git URL (branch and folder go after `#`, not as a GitHub `tree/` link):

   ```
   https://github.com/Mr7d8/Content-Lab.git#main:apps/worker
   ```
3. In the actor's settings, add environment variables (mark keys as secret): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `TYPESAFE_API_KEY`, and optionally `GEMINI_MODEL`, `JEV_MODEL`, `VISION_PROVIDER`, `APIFY_CREATIVE_CENTER_ACTOR_ID` (default `fetch_cat~tiktok-ads-library-scraper`), `GROQ_REQUESTS_PER_MINUTE`, `GEMINI_REQUESTS_PER_MINUTE`. Apify injects `APIFY_TOKEN` itself. Each build keeps the variables set when it ran, so build again after changing them.
4. In the actor's **Settings**, set the default run **Timeout** to 3600 seconds (new actors default to 300, too short for a run).
5. Put the actor id (shown in the console URL, or `yourname~content-lab-worker`) in the dashboard's `APIFY_WORKER_ACTOR_ID`.
6. After code changes land on `main`, click **Build** on the actor so it runs the new code.

Locally, the same code runs with `pnpm worker:dev --run <run id>` or `pnpm worker:dev --sweep` (needs FFmpeg).

## 5. Dashboard on Vercel

Create a Vercel project from this repository with the root directory `apps/web` (framework: Next.js). Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `APIFY_TOKEN` and `APIFY_WORKER_ACTOR_ID`, and optionally `NEXT_PUBLIC_SITE_URL` for magic link redirects. Locally: `pnpm dev`.

## 6. Research mode (daily sweep)

Watchlists refresh on their own through one Apify Schedule that starts the worker in sweep mode. See [research-mode.md](research-mode.md) for how a sweep picks ads.

1. In the Apify console, open **Schedules**, then **Create new**.
2. Cron: `0 6 * * *`, time zone **Africa/Casablanca** (every day at 06:00).
3. **Add** an actor: pick the worker actor, set the input to `{ "mode": "sweep" }`, and under run options set the timeout to 3600 seconds.
4. Save and make sure the schedule is enabled.

Each day the sweep runs the watchlists that are due (weekly or monthly, most overdue first), keeps the best new ads of each and processes them. It stops when this month's spend reaches the cap on **Collect** ($5 by default), after about 40 minutes (the rest wait for the next day), or when the daily sweep is switched off there. **Research now** on Collect runs one watchlist immediately under the same caps.

## 7. First pilot

1. Open `/demo` to see the animated views on synthetic data (no keys needed).
2. Sign in, open **Collect**, paste three TikTok video links, keep the suggested spend cap, and start.
3. Follow the run on **Live**. Each item goes fetch, extract, transcribe, vision, classify.
4. Check the results in **Library** and correct any label that is wrong; corrections are kept next to the model output.
5. Then do the 10 hand-picked strong ads from the plan's checklist to judge label quality before any scraping.

## Known limits

- **Creative Center** searches use `fetch_cat/tiktok-ads-library-scraper`; its input and output field names follow its listing and are checked against a first real run. Pasted Creative Center links still need an actor that accepts detail URLs, or they are flagged for review. TikTok video links work through `clockworks/tiktok-scraper`.
- **Morocco in Creative Center** is unconfirmed. If the Morocco sweeps come back empty, add organic keyword or hashtag watchlists for Morocco instead.
- **Field names** of the TikTok scraper output and the Jev request shape follow their documentation and Creator Lab's working client; confirm both on the first pilot.
- **Percentiles** on the performance map are ranked within each source from its primary metric (views for organic, CTR for Creative Center) until the Phase 2 scoring step fills `scores`.

## Development

```sh
pnpm test        # Vitest: core, worker (generated FFmpeg clips, no paid calls), web
pnpm typecheck
pnpm build
pnpm db:check    # migrations and RLS checks on a throwaway Postgres
```
