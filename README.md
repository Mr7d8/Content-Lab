# Content Lab

Internal tool that collects top TikTok ads in our categories, tags every creative element, and turns the winning patterns into a production brief for the VCC, Motion and Design teams.

Status: **Phase 1 built** (manual import, processing pipeline, Library, animated views). Next: a pilot on hand-picked ads, then Phase 2 scheduled collection and scoring.

## How it works

1. **Collect**: paste TikTok or Creative Center links, see the cost estimate, set a spend cap, start.
2. **Worker** (Apify actor): resolves each link through Apify, downloads the video once, extracts WebP keyframes, scene cuts and audio with FFmpeg, transcribes with Groq, then deletes the raw video.
3. **Classification in two calls**: a vision pass (Gemini free tier, or Claude) describes every keyframe and reads all on-screen text; TypeSafe Jev classifies transcript plus vision text into the taxonomy. Music-only ads work from the vision text alone.
4. **Library**: filter on any label, open an item to see its keyframes, transcript roles, labels with evidence, and correct labels.
5. **Live wall, performance map, Replay**: the run animates as results land, and replays from saved data for screen recording. `/demo` rehearses it on synthetic data.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 dashboard (Vercel) |
| `apps/worker` | Pipeline worker, packaged as an Apify actor |
| `packages/core` | Taxonomy, Zod schemas, the AI provider interface, sources, cost math, DB types |
| `supabase/` | Migrations, local config, SQL behaviour checks |
| `scripts/` | `doctor`, DB type generator, DB check |

## Start

See **[docs/SETUP.md](docs/SETUP.md)**. In short:

```sh
pnpm install
cp .env.example .env            # and apps/web/.env.local
pnpm run doctor --online
pnpm dev                        # dashboard
pnpm worker:dev --run <run id>  # worker, locally
pnpm test
```

## Docs

- [Build plan](docs/build-plan.md)
- [Phase 1 proposal and decisions](docs/phase-1-proposal.md)
- [Setup](docs/SETUP.md)

Inspired by [Creator Lab](https://github.com/artemnovitckii/creator-lab), rebuilt for ads, for TikTok, and for decisions rather than browsing.
