# Phase 1 proposal: repo structure and schema

Status: **approved** (Oct 1, 2026). Building in the order of section 5, one commit per step.

Scope: TikTok only, free tiers first, classification by a vision pass plus TypeSafe Jev. See [the build plan](build-plan.md).

## 1. Repo structure

```
content-lab/
├── apps/
│   ├── web/                         Next.js App Router, TypeScript, Tailwind (Vercel)
│   │   ├── app/
│   │   │   ├── login/               Email magic link
│   │   │   ├── collect/             Paste links, cost estimate, spend cap, run history
│   │   │   ├── runs/[id]/live/      Live run wall + performance map
│   │   │   ├── runs/[id]/replay/    Replay a finished run from saved data, no API calls
│   │   │   ├── library/             Thumbnail grid, filters on any label
│   │   │   └── library/[id]/        Item detail: keyframe strip, transcript, labels + evidence
│   │   ├── components/              Wall, map (D3 in SVG), label chips, keyframe strip
│   │   ├── lib/supabase/            Server and browser clients, signed URL helper
│   │   ├── lib/selection-store.ts   Zustand store shared by wall and map
│   │   └── middleware.ts            Session refresh, redirect to /login
│   └── worker/                      Node 22 + FFmpeg, Dockerfile, Apify actor
│       ├── .actor/                  actor.json, input_schema.json ({ runId })
│       ├── Dockerfile
│       ├── src/
│       │   ├── main.ts              Apify entry: read input, call runner
│       │   ├── dev.ts               Same runner from the CLI: pnpm worker:dev --run <id>
│       │   ├── runner.ts            Loop over run_items, pause check, spend cap, retries
│       │   └── stages/              fetch.ts, extract.ts, transcribe.ts, vision.ts, classify.ts
│       └── test/                    Mocked providers, tiny FFmpeg-generated fixture
├── packages/
│   └── core/                        Shared by web and worker
│       └── src/
│           ├── taxonomy.ts          Label sets, Zod record schema, PROMPT_VERSION
│           ├── record.ts            Assembles the record from Jev answers, vision elements, FFmpeg, metadata
│           ├── sources.ts           Source ids (tiktok_creative_center, ...), regions (MENA group), objective mapping
│           ├── urls.ts              Parse TikTok and Creative Center URLs into source + external_id
│           ├── cost.ts              Per-item cost estimate and cap math (rates flagged "verify")
│           ├── ai/                  One AIProviders interface for every AI call
│           │   ├── index.ts         AIProviders { transcribe, describeFrames, classify, writeBrief }, picked by env
│           │   ├── groq.ts          Transcription (free tier)
│           │   ├── gemini.ts        Vision pass and brief writing (free tier)
│           │   ├── claude.ts        Same two capabilities, for the later switch
│           │   ├── jev.ts           Taxonomy questions to Jev, answers back to typed fields
│           │   └── pacer.ts         Shared request pacer for free-tier rate limits
│           ├── prompts/             Vision prompt (VISION_VERSION) and brief prompt
│           └── db.ts                Generated Supabase types
├── supabase/
│   ├── config.toml
│   └── migrations/
│       ├── 20261001000000_init.sql
│       └── 20261001000100_first_sweep_watchlists.sql
├── scripts/doctor.mjs               Checks Node, FFmpeg, every env var and provider key (no paid calls)
├── .env.example
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.workspace.ts
└── docs/
```

**How the pieces talk**

1. **Collect screen** (signed-in user, RLS applies): validates pasted URLs, shows the cost estimate, then inserts a `runs` row with a required `spend_cap_usd`, the `items` (skipping any already collected) and `run_items`. It then starts the worker actor through the Apify API with `{ runId }`.
2. **Worker** (Apify actor, service role key): walks `run_items` in `position` order through fetch, extract, transcribe, vision and classify, resuming each item at its recorded `stage`. It checks `runs.pause_requested` between items, retries a stage once, then marks the item `needs_review`. Before each item it checks that the estimated paid cost (Apify, Jev) still fits under the cap; if not, the run stops as `paused` with the reason. Free-tier calls (Groq, Gemini) go through the pacer, so rate limits slow the run instead of failing it.
3. **Live run wall**: Supabase Realtime on `run_items`, `items` and `classifications` drives the pop-in thumbnails and fading label chips.
4. **Replay**: reads `run_items.stage_log` timestamps plus saved items and labels, and animates them on its own clock.

The worker runs the same code locally (`pnpm worker:dev --run <id>`) and as the Apify actor, so the pipeline is testable before any deploy.

## 2. Key technical choices

| Area | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere, ESM, Node 22 | One type system from taxonomy to UI |
| Monorepo | pnpm workspaces, no Turborepo yet | Three packages do not need a build orchestrator |
| Taxonomy | One source of truth in `core/taxonomy.ts`: label arrays feed the Zod schema, the Jev question set, the TS types and the dashboard filters | Adding a label is a one-file change plus a `PROMPT_VERSION` bump |
| Vision pass (call 1) | All keyframes in one request to `VISION_PROVIDER` (default `gemini`, free tier). Returns per frame: scene description, all on-screen text, visible elements. Output validated by Zod | Turns pixels into text Jev can read; reveal timings come from the visible elements |
| Classification (call 2) | TypeSafe Jev, built like Creator Lab's `lib/schema.mjs`: choice questions for single labels, yes/no questions for each lever and proof signal, one request per item. State = transcript (or a "no speech" marker) + vision text + source context. Answers mapped into the record and validated by Zod, one retry on failure | Jev is text only and returns no free text, so numbers, times and quotes come from the vision pass, FFmpeg or metadata |
| AI providers | One `AIProviders` interface in `core/ai/`; each capability picked by env (`VISION_PROVIDER`, `BRIEF_PROVIDER` = `gemini` or `claude`) | Free tiers now, Claude later, by config |
| Cache | Vision output looked up by `(video_hash, vision_version, vision_model)`; classification by `(video_hash, prompt_version, vision_version, model)` | A re-run or duplicate video never pays twice, and a taxonomy change does not redo the vision pass |
| Free tiers | Supabase Free, Vercel Hobby, Apify free credit, Groq and Gemini free tiers. Keyframes as 540 px WebP; one shared pacer per free-tier provider | Jev is the only paid AI line (no free tier, well under a cent per ad) |
| Tests | Vitest, providers mocked through injected `fetch`, FFmpeg tests on a clip generated at test time (`lavfi testsrc`) | No paid calls and no binary fixtures in git |
| UI | Apple-style design tokens from your internal tools, Motion for animation, D3 scales in SVG, Zustand for shared selection | As specified; every animated view also has a static mode and respects reduced motion |

## 3. Schema: what changed from the plan

The migration keeps all nine planned tables and columns. These are the additions, each for a specific reason:

| Change | Reason |
| --- | --- |
| **New table `team_members`** + `is_team_member()` | Magic link sign-in lets anyone with an email create an auth user, so "authenticated" is not a team boundary. Every RLS policy checks this allowlist. Members are added by an admin in the SQL editor. |
| **New table `run_items`** | The plan needs "status per item per stage" and Replay needs per-item timestamps. Items are deduplicated across runs, so status cannot live on `items`. Holds `stage` (fetch, extract, transcribe, vision, classify, done), `status`, `attempts`, `error`, `stage_log`, `cost_usd`. |
| `watchlists.source` + unique target, `industry` type, region and objective checks | A watchlist must say which collector it feeds; `industry` covers the Creative Center category sweeps; region is a country code or a group like `MENA`, null meaning any region. |
| **Seed migration** `20261001000100_first_sweep_watchlists.sql` | First sweep: e-commerce sweeps for Morocco, MENA and France (App Install and Purchase, monthly), plus Temu, Shein and AliExpress in any region (weekly). |
| `media.frames_json`, `vision_model`, `vision_version`; `ocr_text` now filled by the vision pass | Stores call 1 (scene description, on-screen text and visible elements per frame) for caching and the item detail view. |
| `media.width`, `height`, `scene_cuts` | FFmpeg measurements for aspect ratio and cut counts, kept because the raw video is deleted. |
| `runs.spend_cap_usd` (required), `cost_actual_usd`, `items_failed`, `pause_requested`, `worker_run_id`, `created_by` | Enforced spend cap, pause signal from dashboard to worker, and re-attaching a lost Apify launch (a Creator Lab lesson). |
| `metrics.value_text` | Creative Center reports tiers (CTR tier, budget tier), not numbers. Unknown metrics get no row at all. |
| `media.transcript_segments` | Whisper timestamps, needed to highlight hook, setup, demo, offer and CTA passages. |
| `classifications.video_hash`, `vision_version`, `needs_review`, `corrections_json`, `reviewed_at`, token and cost columns | Cache lookups, which vision output a record was built from, review queue, human corrections stored next to (never over) model output for later few-shot use, real cost tracking. `confidence` is the lowest Jev confidence so one weak label is never hidden by an average. Evidence per field is its origin, probabilities and the frames or transcript lines judged, since Jev writes no notes. |
| `patterns.direction`, `share_top`, `share_all`, `cohort_count`, `region`; nullable `confidence` | Non-gated combos are kept as `neutral` so Install vs Purchase can compare lifts on both sides. |
| `briefs.title`, `model`, `prompt_version` | Traceability of how each brief was produced. |

Other conventions in the SQL: `source` is open text with a channel prefix and a format check (`tiktok_creative_center`, `tiktok_organic`, `tiktok_commercial_library`, `tiktok_own_ads`), so another channel needs no schema change. `anon` has no table privileges. The `frames` bucket is private (WebP or JPEG, 512 KB max, sized for Supabase Free storage) and readable only by team members through signed URLs. Realtime is enabled on `runs`, `run_items`, `items` and `classifications` for the live run wall.

**Validation done**: both migrations were applied to a clean Postgres 16 database with stand-ins for Supabase's `auth`, `storage` and Realtime publication, then 19 checks passed: outsiders blocked, team flow works, members cannot edit the allowlist, outsiders see zero rows, anon denied, `(source, external_id)` unique, spend cap required, no empty metric rows, period format, pattern uniqueness with null region, `updated_at` triggers, cascades from `items`, `frames` bucket policy, 9 first-sweep watchlists seeded, region code check, watchlist uniqueness, a music-only ad with no transcript stored and classified, `frames_json` shape, and the 512 KB bucket limit. It needs Postgres 15 or later (`unique nulls not distinct`), which new Supabase projects already use.

## 4. Decisions

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Extra tables `team_members` and `run_items` | Approved |
| 2 | How pasted TikTok links become downloadable video | Apify only, on the free credit: `clockworks/tiktok-scraper` with video download on. It also returns views, likes, shares and the sound used. Creative Center links need a Creative Center actor, chosen and checked against one test URL before use. Meta's Muse Spark API is noted as an optional second vision adapter (see the build plan). |
| 3 | Structured evidence instead of written notes | Open. Evidence is stored as structured data now; the record schema keeps an optional `note` per field, so written notes can be added later (by the vision model or the brief writer) without a migration. |
| 4 | Team emails | Only Ossama for now. The email is added once in the Supabase SQL editor when the project is created, not committed to the repo. |

## 5. Build order after approval

One commit per step, tests with mocked providers at each step:

1. Monorepo skeleton, Supabase config, both migrations, generated DB types
2. `core/taxonomy.ts`, Zod record schema, `PROMPT_VERSION`, sources and regions, URL parsing, cost math
3. Manual import: Collect screen, cost estimate, required spend cap, run creation, actor trigger
4. Worker (Apify actor): fetch, FFmpeg audio, keyframes (0, 1, 2, 3 s then every 3 s, 540 px WebP), scene cuts and size, Storage upload, Groq transcription, raw video deleted
5. AI interface in `core/ai/`, then classification in two calls: Gemini vision pass on the keyframes, then Jev on transcript + vision text, Zod validation, one retry, hash caches, music-only ads covered by tests
6. Library grid with label filters and item detail view
7. Animated UI like the Creator Lab demo: live run wall (Realtime + Motion), D3 performance map synced through Zustand, Replay mode with no API calls, reduced-motion support
8. `doctor` script covering Apify, Groq, Gemini and TypeSafe keys
