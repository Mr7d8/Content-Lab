# Research mode: scheduled watchlist sweeps

Proposal, waiting for approval. Decided so far: scheduled sweeps plus a Research now button (no topic research, no automatic briefs yet), and a monthly cap of $5 so sweeps stay inside Apify's free credit.

## What you get

- Each active watchlist refreshes on its own: Temu, Shein and AliExpress every week, the Morocco, MENA and France category sweeps every month.
- A sweep finds that watchlist's top ads, keeps the best 10 that are not in the Library yet, and runs them through the existing pipeline (fetch, extract, transcribe, vision, classify). They show up in Library tagged, and on Live while they run.
- **Research now** on any watchlist runs it immediately, whatever its schedule.
- Collect shows every watchlist with its cadence, last and next sweep, ads per sweep and an on/off switch, plus **Add watchlist** for new advertisers (Noon, Jumia, Namshi...), keywords, hashtags or accounts.
- A meter on Collect shows this month's spend against the $5 cap.

## How a sweep works

1. **Pick:** an Apify Schedule starts the worker once a day with `{ "mode": "sweep" }`. The worker lists active watchlists that are due: never swept, or swept more than 7 days ago (weekly) or 30 days ago (monthly). The most overdue go first.
2. **Discover:** for each due watchlist the worker creates a run and asks the source for candidates:
   - Creative Center watchlists (`industry`, `advertiser`) use a Creative Center Top Ads actor: country, period (7 days for weekly, 30 for monthly), industry, objective, keyword for advertisers. Results carry CTR, likes, budget tier and the video.
   - Organic watchlists (`keyword`, `hashtag`, `account`) use `clockworks/tiktok-scraper`, which the pipeline already uses, without video download at this step.
3. **Rank and dedupe:** candidates are ranked within their own source (CTR, then likes, for Creative Center; views for organic, the same primary metrics as the performance map). Anything already collected is skipped. The top `max_items` (10 by default) become the run's items.
4. **Process:** the normal pipeline runs. Creative Center items reuse the video URL from discovery, so they cost no second scrape.
5. **Stop rules:** before each new watchlist the worker checks the month's spend against the cap and its own clock. It stops starting new sweeps after about 40 minutes, so the day's run ends well inside its one-hour timeout; anything still due waits for tomorrow.

Research now creates the same kind of run from the dashboard and starts the worker for it, after the same monthly cap check.

## Budget

| | Estimate |
| --- | --- |
| Sweeps per month | 6 monthly + 3 weekly × 4.3 ≈ 19 |
| Ads processed per month | ≈ 190 (10 per sweep) |
| Paid cost per ad | ≈ $0.01 (Apify scrape and compute, Jev); Groq and Gemini free |
| Discovery per sweep | a few cents (one actor call) |
| Month | ≈ $2 to $3, under the $5 cap |

These are estimates from `packages/core/src/cost.ts`. The cap is the real guard:
- The month's spend counts every run, pasted-link pilots included, because they share the same free credit.
- Once the month reaches $5, no watchlist run starts until the 1st of next month.
- Each sweep run also has its own cap of $0.50.

Both caps live in the new `app_settings` row.

## Changes

**Database** (`supabase/migrations/20261002000000_research_mode.sql`):
- `watchlists.max_items` (default 10) and `watchlists.last_swept_at`
- `runs.trigger` (`manual` or `schedule`)
- `app_settings` (one row): monthly cap $5, per-sweep cap $0.50, sweeps on/off; team members can read and update it
- `month_spend_usd()`: paid spend so far this calendar month (UTC)

**Worker** (`apps/worker`):
- discovery for watchlist runs
- sweep mode with due selection, cap and time budget
- recovery of runs left "running" by a timed-out actor: claimable again after 75 minutes without an update

**Core** (`packages/core`): pure functions for actor inputs, candidate normalizing, ranking and "is due", with tests.

**Dashboard** (`apps/web`):
- watchlist table, Research now, Add watchlist, on/off switch, ads per sweep
- spend meter on Collect
- a "Scheduled" badge on runs started by the sweep

## Build steps (a commit after each)

1. Migration, generated types, database checks for the new pieces.
2. Core: discovery inputs, normalizers, ranking, due logic, with tests.
3. Worker: discovery stage for watchlist runs, stale run recovery.
4. Worker: sweep mode (`{ "mode": "sweep" }`) with the monthly cap and time budget.
5. Dashboard: watchlists on Collect, Research now, Add watchlist, spend meter, Scheduled badge.
6. Setup docs, deploy, and one supervised sweep.

## What I need from you

1. **Before step 2: one test run of the Creative Center actor.** This sandbox cannot reach apify.com, so I cannot read the actor's input and output formats.
   - In the Apify console, open [`fetch_cat/tiktok-ads-library-scraper`](https://apify.com/fetch_cat/tiktok-ads-library-scraper). I recommend it because it supports keyword search, which the Temu, Shein and AliExpress watchlists need. [`automation_craft/tiktok-creative-center-scraper`](https://apify.com/automation_craft/tiktok-creative-center-scraper) is the fallback.
   - Run it with region Morocco, last 30 days and 5 results.
   - Send me the input JSON (Input tab, JSON view) and one result from the dataset (JSON).
   - It costs cents and answers the open question of whether Creative Center covers Morocco. If it does not, the Morocco sweeps move to organic keyword and hashtag watchlists.
2. **After the build:** in Apify, create a Schedule (Schedules, Create) that runs the worker actor daily with input `{ "mode": "sweep" }` and a timeout of 3600 seconds. Also set the actor's default run timeout to 3600 in its Settings tab. I will put the exact steps in `docs/SETUP.md`.
3. **The migration:** run it in the Supabase SQL editor, like the first two.

## Risks

- **Actor output shapes** are unverified until the test run; the normalizers will be written against your sample and fail loudly on anything else.
- **Creative Center video URLs are signed and expire.** Discovered ads are processed in the same run, minutes later. If one has expired, that item goes to Needs review instead of failing the run.
- **Gemini's free tier** is paced at 10 requests a minute, and each ad is also downloaded, cut into frames and transcribed, so a 10-ad sweep takes several minutes. Parallel sweeps would share the same rate limits, so they run one after another.
- **The worker actor runs with Apify's limited permissions.** Starting other actors and reading their results should be allowed; the first supervised sweep confirms it.
