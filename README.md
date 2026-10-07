# Content Lab

Internal tool that collects top TikTok ads in our categories, decodes what makes them work, and turns the winning patterns into production briefs for the VCC, Motion and Design teams.

Status: **v2**. One board page, scans in about a minute, decodes on demand. See [the rebuild plan](docs/rebuild-plan.md) for why.

## How it works

1. **Boards.** A board watches one search: video ads running in Meta's Ad Library (keywords or Facebook pages, ranked by days running since Meta shows no CTR), Creative Center top ads for a country and objective (advertisers or keywords match within those, since TikTok keeps keyword search behind its login), or organic TikTok keywords, hashtags or accounts (up to 10 terms per board, separated by commas). Moroccan starters fill the form: Moroccan e-commerce on Meta (COD seller words and YouCan store links), Wasal competitors on Meta (Jumia, Avito, Marjane, Electroplanet, Kitea, YouCan pages), the words Moroccan sellers write (maroc, livraison gratuite, الدفع عند الاستلام, درهم...), the competitors, Moroccan TikTok posts and hashtags, and the Moroccan advertisers found so far (a snowball board that grows as you scan).
2. **Scan.** The dashboard starts the Apify scraper itself and streams the results in while the board is open: ads, their numbers (CTR and likes, or views and likes) and covers, which are copied to Supabase Storage because TikTok links expire. Ads run for another objective than the board's are left out, since the scraper does not always apply that filter. No video is downloaded and no AI runs. Scheduled boards rescan daily from a Vercel Cron, under the monthly spend cap.
3. **Moroccan ads only.** A board with this on shows the ads whose text reads Moroccan, leaves out the ones made for other countries, and checks the unclear ones: their landing page (from Creative Center's detail record: store currency, locale, WhatsApp numbers, couriers, text), then a Gemini read of the cover. Ads found Moroccan add their advertiser to a list that snowball boards follow; "Moroccan" and "Not Moroccan" in the inspector confirm or block an advertiser. Left-out ads stay one click away.
4. **Decode, when you ask.** Pick one ad, the top 10, or drag across the map. Each decode sends the video to Gemini once: speech, what is on screen second by second, the hook, each script beat, the offer, the call to action and why it works. TypeSafe Jev then tags it with the taxonomy (format, hook type, structure and more).
5. **The board.** KPIs, the top ads, a performance map of every cover (gray until decoded), the inspector with the video, its breakdown, the ad frame by frame (image, what is on screen, the text, what is said, at each moment) and its timing and craft, and "Which formats win?" by format, hook, advertiser or length. Frame images are drawn from the video in the browser the first time a decoded ad is opened, then kept in Supabase Storage. A market filter keeps the ads that look made for Moroccan shoppers (dirhams, Darija, Moroccan places, +212 numbers, .ma sites) apart from those made for the Gulf, Egypt, Algeria or elsewhere; it reads the ad text, and after a decode the on-screen text and speech too.

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
