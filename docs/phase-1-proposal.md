# Phase 1 proposal: repo structure and schema

Status: **awaiting approval**. Only this document, the migration SQL and the repo basics are committed. Nothing else gets built until you approve.

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
│       │   └── stages/              fetch.ts, extract.ts, transcribe.ts, classify.ts
│       └── test/                    Mocked providers, tiny FFmpeg-generated fixture
├── packages/
│   └── core/                        Shared by web and worker
│       └── src/
│           ├── taxonomy.ts          Label sets, Zod record schema, PROMPT_VERSION
│           ├── urls.ts              Parse TikTok and Creative Center URLs into source + external_id
│           ├── cost.ts              Per-item cost estimate and cap math (rates flagged "verify")
│           ├── providers/           Transcriber and Classifier interfaces, Groq and Claude impls
│           ├── prompts/             Classification prompt, versioned with the taxonomy
│           └── db.ts                Generated Supabase types
├── supabase/
│   ├── config.toml
│   └── migrations/20261001000000_init.sql
├── scripts/doctor.mjs               Checks Node, FFmpeg, every env var and provider key (no paid calls)
├── .env.example
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.workspace.ts
└── docs/
```

**How the pieces talk**

1. **Collect screen** (signed-in user, RLS applies): validates pasted URLs, shows the cost estimate, then inserts a `runs` row with a required `spend_cap_usd`, the `items` (skipping any already collected) and `run_items`. It then starts the worker actor through the Apify API with `{ runId }`.
2. **Worker** (service role key): walks `run_items` in `position` order, resumes each item at its recorded `stage`, checks `runs.pause_requested` between items, retries a stage once, then marks the item `needs_review`. Before each item it checks that the estimated item cost still fits under the cap; if not, the run stops as `paused` with the reason.
3. **Live run wall**: Supabase Realtime on `run_items`, `items` and `classifications` drives the pop-in thumbnails and fading label chips.
4. **Replay**: reads `run_items.stage_log` timestamps plus saved items and labels, and animates them on its own clock.

The worker runs the same code locally (`pnpm worker:dev --run <id>`) and as the Apify actor, so the pipeline is testable before any deploy.

## 2. Key technical choices

| Area | Choice | Why |
| --- | --- | --- |
| Language | TypeScript everywhere, ESM, Node 22 | One type system from taxonomy to UI |
| Monorepo | pnpm workspaces, no Turborepo yet | Three packages do not need a build orchestrator |
| Taxonomy | One source of truth in `core/taxonomy.ts`: label arrays feed the Zod schema, the JSON schema sent to Claude, the TS types and the dashboard filters | Adding a label is a one-file change plus a `PROMPT_VERSION` bump |
| Classification | Claude API, model from `CLASSIFY_MODEL` (default `claude-sonnet-5-5`), keyframes as JPEG images, JSON output validated by Zod, one retry on validation failure | Matches the plan; model is swappable |
| Providers | `Transcriber` and `Classifier` interfaces in `core` | Lets you start on a free model and switch later, as in the Costs section |
| Cache | Classification looked up by `(video_hash, prompt_version, model)` before any call | A re-run or duplicate video never pays twice |
| Tests | Vitest, providers mocked through injected `fetch`, FFmpeg tests on a clip generated at test time (`lavfi testsrc`) | No paid calls and no binary fixtures in git |
| UI | Apple-style design tokens from your internal tools, Motion for animation, D3 scales in SVG, Zustand for shared selection | As specified; every animated view also has a static mode and respects reduced motion |

## 3. Schema: what changed from the plan

The migration keeps all nine planned tables and columns. These are the additions, each for a specific reason:

| Change | Reason |
| --- | --- |
| **New table `team_members`** + `is_team_member()` | Magic link sign-in lets anyone with an email create an auth user, so "authenticated" is not a team boundary. Every RLS policy checks this allowlist. Members are added by an admin in the SQL editor. |
| **New table `run_items`** | The plan needs "status per item per stage" and Replay needs per-item timestamps. Items are deduplicated across runs, so status cannot live on `items`. Holds `stage`, `status`, `attempts`, `error`, `stage_log`, `cost_usd`. |
| `watchlists.source` + unique target | A watchlist must say which collector it feeds. Prevents duplicate watchlists. |
| `runs.spend_cap_usd` (required), `cost_actual_usd`, `items_failed`, `pause_requested`, `worker_run_id`, `created_by` | Enforced spend cap, pause signal from dashboard to worker, and re-attaching a lost Apify launch (a Creator Lab lesson). |
| `metrics.value_text` | Creative Center reports tiers (CTR tier, budget tier), not numbers. Unknown metrics get no row at all. |
| `media.transcript_segments` | Whisper timestamps, needed to highlight hook, setup, demo, offer and CTA passages. |
| `classifications.video_hash`, `needs_review`, `corrections_json`, `reviewed_at`, token and cost columns | Cache lookups, review queue, human corrections stored next to (never over) model output for later few-shot use, real cost tracking. `confidence` is the lowest field confidence so one weak label is never hidden by an average. |
| `patterns.direction`, `share_top`, `share_all`, `cohort_count`, `region`; nullable `confidence` | Non-gated combos are kept as `neutral` so Install vs Purchase can compare lifts on both sides. |
| `briefs.title`, `model`, `prompt_version` | Traceability of how each brief was produced. |

Other conventions in the SQL: `source` is open text with a format check (no schema change to add Meta or YouTube later), `anon` has no table privileges, the `frames` bucket is private (JPEG or WebP, 2 MB max) and readable only by team members through signed URLs, and Realtime is enabled on `runs`, `run_items`, `items` and `classifications`.

**Validation done**: the migration was applied to a clean Postgres 16 database with stand-ins for Supabase's `auth`, `storage` and Realtime publication, then 13 checks passed: outsiders blocked, team flow works, members cannot edit the allowlist, outsiders see zero rows, anon denied, `(source, external_id)` unique, spend cap required, no empty metric rows, period format, pattern uniqueness with null region, `updated_at` triggers, cascades from `items`, and the `frames` bucket policy. It needs Postgres 15 or later (`unique nulls not distinct`), which new Supabase projects already use.

## 4. Decisions needed before building

1. **Approve the two extra tables** (`team_members`, `run_items`). Recommendation: yes.
2. **How pasted TikTok links become downloadable video.** A TikTok page URL is not a media file, so the worker must resolve it.
   - **Apify (recommended)**: run `clockworks/tiktok-scraper` on the pasted URLs with video download on. Pays a small per-result fee, stays in your stack, and returns views, likes and shares at the same time, which become `metrics` rows.
   - **yt-dlp in the worker image**: free, but it is unofficial scraping and breaks when TikTok changes.
   - Creative Center ad links will need a Creative Center actor either way; I will pick one once you approve and confirm its output with a single test URL.
3. **First team emails** to seed into `team_members` (can also be done later in the SQL editor).

## 5. Build order after approval

One commit per step, tests with mocked providers at each step:

1. Monorepo skeleton, Supabase config, this migration, generated DB types
2. `core/taxonomy.ts`, Zod record schema, `PROMPT_VERSION`, URL parsing, cost math
3. Manual import: Collect screen, cost estimate, spend cap, run creation, actor trigger
4. Worker: fetch, FFmpeg audio and keyframes (0, 1, 2, 3 s then every 3 s), Storage upload, Groq transcription, raw video deleted
5. Classification: Claude call with keyframes, transcript and source context, Zod validation, one retry, hash cache
6. Library grid with label filters and item detail view
7. Live run wall, performance map with shared selection, Replay mode, reduced-motion support
8. `doctor` script
