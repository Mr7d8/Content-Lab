# Content Lab

Internal tool that collects top TikTok ads in our categories, decodes what makes them work, and turns the winning patterns into production briefs for the VCC, Motion and Design teams.

Status: **v2**. One board page, scans in about a minute, decodes on demand. See [the rebuild plan](docs/rebuild-plan.md) for why.

## How it works

1. **Boards.** A board watches one search: Creative Center top ads for a country and objective, an advertiser or a keyword, or an organic TikTok keyword, hashtag or account.
2. **Scan.** The dashboard starts the Apify scraper itself and streams the results in while the board is open: ads, their numbers (CTR and likes, or views and likes) and covers, which are copied to Supabase Storage because TikTok links expire. No video is downloaded and no AI runs. Scheduled boards rescan daily from a Vercel Cron, under the monthly spend cap.
3. **Decode, when you ask.** Pick one ad, the top 10, or drag across the map. Each decode sends the video to Gemini once: speech, what is on screen second by second, the hook, each script beat, the offer, the call to action and why it works. TypeSafe Jev then tags it with the taxonomy (format, hook type, structure and more).
4. **The board.** KPIs, the top ads, a performance map of every cover (gray until decoded), the inspector with the video and its breakdown, and "Which formats win?" by format, hook, advertiser or length.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 dashboard on Vercel: the board, scans, decodes, the daily cron |
| `packages/core` | Taxonomy, scan parsers, the decode schema and prompt, AI providers, DB types |
| `supabase/` | Migrations and SQL behaviour checks |
| `scripts/` | `doctor`, DB type generator, DB check |

## Start

See **[docs/SETUP.md](docs/SETUP.md)**. In short:

```sh
pnpm install
cp .env.example apps/web/.env.local
pnpm run doctor --online
pnpm dev
pnpm test
```

## Docs

- [Setup](docs/SETUP.md)
- [v2 rebuild plan](docs/rebuild-plan.md)
- History: [v1 build plan](docs/build-plan.md), [phase 1 proposal](docs/phase-1-proposal.md)

Inspired by [Creator Lab](https://github.com/artemnovitckii/creator-lab), rebuilt for ads, for TikTok, and for decisions rather than browsing.
