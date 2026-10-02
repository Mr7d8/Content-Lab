# Setup

From an empty Supabase project to a first decoded board. Everything runs in the dashboard on Vercel: there is no worker to deploy.

## 1. Accounts and keys

| Service | Plan | What you need |
| --- | --- | --- |
| Supabase | Free | A project: Project URL, anon (publishable) key, service_role key |
| Vercel | Hobby (move to Pro if this becomes a Wasal tool) | A project for `apps/web` |
| Apify | Free monthly credit, then pay per result | API token |
| Google AI Studio | Billing on | Gemini API key (decoding) |
| TypeSafe | Paid | API key (Jev classification) |
| Anthropic | Optional | API key, only if `BRIEF_PROVIDER` is `claude` |

Decoding sends whole videos to Gemini, which the free tier rate limits after a few ads, so turn billing on for the key. With billing on, Google does not use the prompts to train its models.

What things cost (estimates, checked against the bills):

| Action | Cost |
| --- | --- |
| Scan of 30 ads | about $0.10 (Apify, pay per result); 200 ads about $0.61 |
| Decode of one ad | about $0.01 to $0.02 (Gemini video plus Jev) |

Both count toward the monthly cap set in the spend chip on the board ($5 by default).

## 2. Database

1. Create the Supabase project (Postgres 15 or later).
2. Apply the migrations in order, with the Supabase CLI (`supabase link`, then `supabase db push`) or by pasting each file from `supabase/migrations/` into the SQL editor:
   - `20261001000000_init.sql`: tables, RLS, Realtime.
   - `20261001000100_first_sweep_watchlists.sql`: the first boards.
   - `20261002000000_research_mode.sql`: schedules, `app_settings` with the monthly cap, `month_spend_usd()`.
   - `20261002000100_close_functions_to_anon.sql`: signed-out visitors cannot call the app's functions.
   - `20261003000000_v2_boards.sql`: board membership, scan and decode status, the public `covers` bucket, decode spend.
   - `20261003000100_scan_json.sql`: the latest scan row per ad.
   - `20261004000000_scan_up_to_200.sql`: up to 200 ads per scan.
3. Add yourself to the allowlist (only listed emails can see any data):

   ```sql
   insert into public.team_members (email) values ('you@example.com');
   ```

4. Authentication > URL Configuration:
   - **Site URL**: your dashboard URL, for example `https://content-lab-iota.vercel.app`. New projects default to `http://localhost:3000`, which sends magic links to your own computer.
   - **Redirect URLs**: `https://content-lab-iota.vercel.app/auth/callback`, `https://*-mr7d8s-projects.vercel.app/auth/callback` (previews) and `http://localhost:3000/auth/callback` (local work).

To check the SQL on a throwaway local Postgres: `DATABASE_URL=postgres://... pnpm db:check`. After changing a migration, regenerate types with `pnpm db:types`.

## 3. Dashboard on Vercel

Create a Vercel project from this repository with the root directory `apps/web` (framework: Next.js). Add these environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; used after the team check, to save scans, covers and decodes)
- `APIFY_TOKEN`
- `GEMINI_API_KEY`, `TYPESAFE_API_KEY`
- `CRON_SECRET`: any long random string. Vercel Cron sends it to the daily scan route, and it signs the Apify webhook that finishes a scan when no board is open.
- optionally `NEXT_PUBLIC_SITE_URL`, `GEMINI_MODEL`, `JEV_MODEL`, `APIFY_CREATIVE_CENTER_ACTOR_ID`, `APIFY_TIKTOK_ACTOR_ID`

Never prefix a secret with `NEXT_PUBLIC_`: that ships it to the browser. Vercel only applies new variables to new deployments, so redeploy after changing them.

Decodes run up to 5 minutes per ad, which needs Fluid compute (on by default for new Vercel projects).

Keep one Vercel project for this repository: each connected project builds every push, and the Hobby plan allows 100 deployments a day across the account. `apps/web/vercel.json` turns off deployments for `claude/` branches (the branches Claude Code works on); main still deploys to production on every merge.

## 4. Local development

```sh
pnpm install
cp .env.example apps/web/.env.local   # fill in the keys
pnpm run doctor                        # presence checks, no network
pnpm run doctor --online               # checks each key against its provider (free calls only)
pnpm dev
```

## 5. Scheduled scans

`apps/web/vercel.json` declares a Vercel Cron that calls `/api/cron/sweep` every day at 05:00 UTC (06:00 in Morocco). It starts a scan for each board that is due (weekly or monthly, set in the board menu) under the monthly cap. Boards set to manual only scan when you click **Scan now**. The daily scans can be switched off in the spend chip.

A scan started by the cron finishes on its own: Apify calls `/api/apify/webhook` when the scraper ends, and the dashboard pulls the results in. An open board does the same every few seconds, so ads appear as they arrive.

## 6. First board

1. Sign in. With no boards yet, click **Create your first board**; otherwise open the board switcher and pick **New board**.
2. Choose Top ads (Creative Center), a country and an objective, and create it. The first scan starts at once and ads stream in within a minute or two.
3. Click any cover to open it in the inspector, then **Decode this ad**. Or **Decode top 10**, or drag across the performance map to pick several.
4. When a few are decoded, "Which formats win?" fills in.

## Known limits

- **Creative Center video links** expire after about 6 hours. Covers are cached, so the board stays visual; the inspector's player needs a recent scan. Decoding fetches a fresh copy of the video itself.
- **Industry filters** need Creative Center keys such as `label_22110000000`. Boards with a plain word (for example `ecommerce`) scan every industry for their country and objective.
- **Budget tier** in the inspector is Creative Center's cost index (0, 1, 2), shown as Low, Medium, High.
- Videos over 14 MB are decoded from a lower resolution copy, when the source has one.

## Development

```sh
pnpm test        # Vitest: core and web, no paid calls
pnpm typecheck
pnpm build
pnpm db:check    # migrations and RLS checks on a throwaway Postgres
```
