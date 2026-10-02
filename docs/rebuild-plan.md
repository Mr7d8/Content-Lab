# Content Lab v2: one fast, visual board

Proposal, waiting for approval (2026-10-02). Inspired by the "Decode the Invo deal" board: every video on one page, plotted by performance, decoded on demand.

## What changes, from the feedback

| Feedback | v2 |
| --- | --- |
| Fetching is slow | A **scan** only fetches ad metadata and covers. Ads appear on the board within about a minute. No video download, no AI. |
| Fetch first, analyze when I ask | **Decode** one ad, a selection, or the top 10, when you choose. One AI call per video, 4 at a time, about 15 to 30 seconds per ad instead of 2 minutes. |
| Bad UI, too many pages | **One board page.** Collect, Library, Live and Replay go away. |

What today's run showed: the scan itself took under a minute (19 Morocco ads). The slowness was processing every ad right away, one after another (download, keyframes, uploads, transcription, vision), and the Gemini free quota ran out after 2 ads (`429 quota exceeded`).

## The board

```
[ Morocco · e-commerce · Purchase  v ]   [ + New scan ]          $1.20 of $5 this month

Decode Morocco e-commerce.
19 top ads from Creative Center, last 30 days. 1 decoded, sorted into 1 format.
[ ADS 19 ] [ ADVERTISERS 12 ] [ DECODED 1 / 19 ] [ MEDIAN CTR 0.87 ]

TOP ADS            PERFORMANCE MAP                                   INSIDE
[covers, ranked]   every ad is its cover, likes x CTR (log scale),   video plays here
                   median lines; hover to zoom, click to inspect,    stats, ad text
                   shift-drag to select, then Decode selected        Decode, or the breakdown:
                   undecoded ads in grey, decoded ones in color      hook, script beats, format, CTA

FORMATS   o Problem / solution 4   o Demo 3   o UGC review 2 ...   (click to filter the map)

WHICH FORMATS WIN?   [ format | hook | advertiser | length ]
bars: median CTR and likes per group, count, its 3 best covers
```

- A live counter while decoding ("Decoding 3 / 10"), with ads turning from grey to color on the map as they finish.
- Boards switch from the top-left menu. **New scan**: Creative Center top ads (country, objective, period, keyword or advertiser) or TikTok organic (keyword, hashtag, account). The daily sweep refreshes boards on their schedule, scan only, never auto-decodes.
- Modern and visual: covers everywhere, large type, monospace labels, smooth motion, works on a phone.

## How it works

- **Scan:** the dashboard starts the Apify actor itself (Creative Center: `fetch_cat/tiktok-ads-library-scraper`; organic: `clockworks/tiktok-scraper` without video download), then pulls results into Supabase every few seconds while the board is open, so ads stream in. Covers are copied to Supabase Storage, since Creative Center links expire after about 6 hours.
- **Decode:** a dashboard function per ad gets the video (from the scan, fetched again if the link expired), sends the whole video to Gemini in one call (transcript, on-screen text, scenes, hook, script beats, CTA), then TypeSafe Jev sorts it into the taxonomy. Results land live on the board.
- **Removed:** the Apify worker actor (so no more Apify builds, ever), FFmpeg keyframes, Groq, and the old pages.
- **Kept:** the Supabase project and today's 19 ads, the watchlists (they become boards), the monthly cap, the taxonomy, Jev and the AI provider interface.

## Build steps (a commit after each)

1. Schema: boards from watchlists, scan and decode status on ads, a `covers` storage bucket. Keeps all data.
2. Scan engine: start the actor, stream results in, save covers.
3. Decode engine: Gemini video call plus Jev, 4 in parallel, on demand.
4. The board UI.
5. Remove the old pages and the worker, update the docs, deploy.

## Decision needed: the AI that decodes

The Gemini free quota ran out after 2 ads today.

- **Gemini with billing on** (recommended): same key, pay as you go. A short video in one Flash call should cost well under a cent per ad (check Google's current price list), with no daily cap.
- **Gemini free tier:** $0, but a small daily number of decodes and frequent "quota" or "high demand" errors.
- **Claude:** strongest script breakdowns, but it reads frames rather than video, costs a few cents per ad, and needs an Anthropic API key.
