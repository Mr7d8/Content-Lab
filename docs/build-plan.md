# Content Lab: Build Plan

Oct 1, 2026 · @Ossama

## Overview

Content Lab is a standalone tool that collects top TikTok ads in our categories, tags every creative element, and turns the winning patterns into a production brief the VCC, Motion and Design teams can shoot from. It is inspired by [Creator Lab](https://github.com/artemnovitckii/creator-lab) but built for ads, for TikTok, and for decisions rather than browsing.

**Questions it must answer**

| Question | Output |
| --- | --- |
| What hooks, formats and structures repeat among top performers in our categories? | Pattern ranking with sample sizes and linked examples |
| What should an App Install asset do differently from a Purchase asset? | Side by side pattern comparison per objective |
| How fast do strong ads reveal the app, product, price and offer? | Timing distributions (seconds to reveal, CTA timing, duration) |
| What are competitors running right now? | Competitor feed by advertiser, refreshed on a schedule |
| What should we produce and test next? | Generated production brief, concept templates and test matrix |

**Goals**

- Replace one-off manual ad research with a repeatable monthly refresh.
- Classify ads that have little or no speech, using frames plus transcript together.
- Export a brief that maps each finding to Pattern, Example, Why it works, Objective, How to adapt.

**Non-goals for v1**

- No causal claims: the tool shows what top performers have in common, not what caused their results.
- No automated ad publishing or spend management.
- No public product: internal tool, single team, behind a login.
- No channels other than TikTok for now. The generic `source` field lets a new channel be added later without a schema change.

## Architecture and stack

Content Lab reuses Brika's building blocks (Apify, Supabase, Vercel) and adds three new ones: Groq for transcription, TypeSafe Jev for classification, and the Gemini API free tier for the vision pass and brief writing, swappable to Claude later. Every stage targets a free tier first.

> Diagram: Content Lab architecture, 4 layers (kept in the original doc)

Heavy video work runs in a separate worker so the Vercel dashboard stays light; the dashboard also sends pasted links straight to the worker.

| Layer | Choice | Shared with Brika | Why |
| --- | --- | --- | --- |
| Collection | Apify actors + manual link import (Apify free credit) | Yes | Same billing, same account, known actors |
| Processing | Node worker with FFmpeg, runs as an Apify actor (Apify free credit) | Apify | FFmpeg and long jobs do not fit Vercel functions |
| Transcription | Groq Whisper (free tier) | No | Fast, handles French and Arabic; test Darija quality early |
| Vision pass | Gemini API free tier, swappable to Claude | No | Turns keyframes into a scene description and all on-screen text per frame |
| Classification | TypeSafe Jev | No | Typed answers with calibrated confidence; text only, so it reads the transcript plus the vision pass output |
| Brief writing | Gemini API free tier, swappable to Claude | No | Turns pattern rows into the production brief |
| Database + files + login | Supabase Free plan (Postgres, Storage, Auth) | Yes | Same tooling, RLS for team access |
| Dashboard | Next.js on Vercel Hobby | Yes | Same deploy flow |
| Analytics | Mixpanel (optional) | Yes | Track which briefs get generated and used |

**One AI interface**: every AI provider (transcription, vision pass, Jev classification, brief writing) sits behind one `AIProviders` interface in `packages/core`. Each capability has its own adapter, picked by environment variables (for example `VISION_PROVIDER=gemini` or `claude`), so moving the vision pass or brief writing from Gemini to Claude is a config change, not a rewrite. Free-tier providers run behind a request pacer that respects their per-minute limits, as in Creator Lab.

## Data sources

TikTok is the only channel in scope for now: four TikTok sources, each kept in its own lane. Ad libraries are the backbone, organic TikTok is a supporting signal, and our own ads come last but carry the strongest evidence.

| Source | `source` value | What it gives | Access route | Role | Phase |
| --- | --- | --- | --- | --- | --- |
| TikTok Creative Center, Top Ads | `tiktok_creative_center` | Top ads by region, industry and objective (App Installs, Conversions, Traffic), with CTR tier, likes and budget tier | Apify actor on the public Creative Center pages, or manual link import | Backbone for both objectives | 1 |
| TikTok organic | `tiktok_organic` | Videos by keyword, hashtag or competitor account, with views, likes, shares, comments | Apify `clockworks/tiktok-scraper` (already in Brika's stack) | Organic formats that ads borrow | 1 |
| TikTok Commercial Content Library | `tiktok_commercial_library` | Official ad archive for ads shown in the EU, useful for France | TikTok Commercial Content API (application required) | Official fallback if scraping is blocked | 2 |
| Wasal's own TikTok ads | `tiktok_own_ads` | Spend, CPI, CPA, ROAS, hook rate, completion rate per creative | TikTok Marketing API (Reporting) | Ground truth: what works for us | 3 |

Source values carry the channel as a prefix, so a future channel adds new values without a schema change.

**Collection rules**

- Every item keeps its source, collection date and original URL, so every finding links back to a real ad.
- Manual link import is always available: paste Creative Center or TikTok links and the pipeline processes them like any scraped item.
- Watchlists define what gets collected: advertisers, category keywords, hashtags, accounts, industries, regions and objectives.
- First sweep watchlists (seeded in the database):
  - Category sweeps in Creative Center for **Morocco**, **MENA** and **France**, each for App Install and Purchase objectives, refreshed monthly. MENA expands to its countries in `packages/core`.
  - Advertiser watchlists for the global e-commerce leaders **Temu**, **Shein** and **AliExpress** in any region, refreshed weekly, for best-in-class creative.
  - Regional competitors (Noon, Namshi, Jumia, Sephora and others) can be added as advertiser watchlists later from the Collect screen.
- Scheduled refresh: weekly for competitor watchlists, monthly for the full category sweep.

**Watch-outs**

- Creative Center metrics are tiers and ranks, not exact results. Rank within a source, never mix sources into one score.
- Confirm that Creative Center offers Morocco as a region filter. If it does not, Morocco comes from organic keyword and hashtag watchlists.
- Other channels are out of scope for now. The generic `source` field lets them be added later without a schema change.
- Wasal's brief asks to prioritize public libraries over unofficial scraping. The dashboard labels every item by source so organic scraped data never passes as ad evidence.

## Processing pipeline

Each item passes seven stages, every stage is resumable, and a failed item never blocks the rest of the run.

1. **Collect**: the run pulls items from a watchlist or pasted links, writes them to `items` with source, URL and raw metadata, and skips anything already collected.
2. **Fetch media**: the worker downloads the video once to temporary storage and records duration and a video hash for caching.
3. **Extract**: FFmpeg pulls the audio track and keyframes at 0, 1, 2 and 3 seconds, then every 3 seconds to the end, saved as 540 px wide WebP to fit Supabase Free storage. It also measures aspect ratio and scene cuts, which are stored because the raw video is deleted right after.
4. **Transcribe**: Groq Whisper returns text with timestamps and a detected language. Music-only audio is marked as such and gives an empty transcript instead of failing, unlike Creator Lab.
5. **Vision pass** (AI call 1): one call to the vision provider (Gemini free tier first) with all keyframes. It returns, per frame, a scene description, all on-screen text, and which elements are visible (app UI, product, price, offer, logo, CTA, faces, number of people). Subtitles, prices and CTAs are captured even with no speech.
6. **Classify with Jev** (AI call 2): one Jev request per item with the transcript (or an explicit "no speech" marker), the vision pass text and source context. Jev answers typed choice, score and yes/no questions built from the taxonomy; the answers are mapped onto the record and validated by the Zod schema. An empty transcript is a normal input, so music-only ads are classified from the vision text alone.
7. **Score and aggregate**: after the run, source metrics are joined, percentiles computed per cohort, and the `patterns` table rebuilt for the period.

**Reliability rules**

- Status per item per stage, so pause and resume pick up exactly where they stopped.
- One automatic retry per stage, then the item is flagged for review.
- Vision cache keyed on video hash plus vision prompt version; classification cache keyed on video hash plus taxonomy and vision versions. A re-run never pays twice.
- Free-tier rate limits (Groq, Gemini) are handled by a shared request pacer, so a long run slows down instead of failing.

## Ad taxonomy

Every video gets one structured record, validated by the Zod schema, assembled from four inputs: Jev's typed answers over the transcript and vision text, the vision pass's per-frame elements, FFmpeg measurements, and source metadata. Fixed labels keep results comparable across months; every label carries a confidence and the input it came from.

Jev reads text only and returns choices, scores and yes/no probabilities, never free text or numbers. So it never sees images (the vision pass turns frames into text first), and anything that is a number, a time or a quote comes from the vision pass, FFmpeg or metadata instead.

| Dimension | Labels (v1) | Filled by | Why it matters for the brief |
| --- | --- | --- | --- |
| Likely objective | app_install, purchase, hybrid, brand | Jev choice | Splits every finding by objective |
| Hook type (0 to 3s) | problem_statement, price_shock, unboxing, pov, reaction, before_after, question, bold_claim, transformation, trend_audio, curiosity_gap, testimonial_open | Jev choice on the 0 to 3s frames and speech | The first thing the team must get right |
| Hook channel | visual_only, text_overlay, spoken, combined | Jev choice | Tells Motion vs VCC where the hook lives |
| Format | creator_ugc, talking_head, screen_recording, app_walkthrough, product_demo, catalogue_carousel, haul, skit, green_screen, slideshow, motion_graphics | Jev choice | Maps directly to a production team |
| Structure | problem_solution, demo_benefit_cta, listicle, story_arc, comparison, offer_first, social_proof_stack | Jev choice | The script skeleton to brief |
| Reveal timing | seconds to first app UI, product, price, offer, logo | Vision pass: first frame where each element is visible | "How fast" answers for both objectives |
| Commercial levers | price_visible, discount, free_delivery, urgency, scarcity, bundle, cash_on_delivery, first_order_offer | Jev yes/no per lever | Purchase asset checklist |
| Social proof | reviews_shown, order_count, creator_endorsement, ugc_montage, ratings, none | Jev yes/no per signal | Trust signals worth testing |
| Execution | duration (s), cut count, cuts per 10s, subtitles, voiceover, music, trend sound, aspect ratio | FFmpeg (duration, cuts, aspect ratio), vision pass (subtitles), audio check (music), Jev (voiceover), source metadata (trend sound, else unknown) | Pacing and finishing specs |
| Language | darija, french, arabic_msa, english, mixed, none | Jev choice, with Whisper's detected language as a hint | Critical for Morocco and MENA |
| CTA | spoken or text, wording, first appearance (s), repeated or not | Vision pass and transcript timestamps (wording, first appearance), Jev (spoken or text, repeated) | CTA timing and copy rules |
| Talent | creator gender, age bracket, number of people, face in first frame | Vision pass (number of people, face in first frame), Jev choice on the vision descriptions (gender, age bracket) | Casting notes |

**Rules carried over from Creator Lab**

- The model labels the creative before any metric is joined, so performance cannot bias the tags.
- Unknown stays unknown: no guessed metrics, no forced labels.
- Vision and classification results are cached by video hash, so a re-run never pays twice.
- A human can correct any label in the dashboard; corrections are stored and used as few-shot examples later.
- Evidence per label is the frames and transcript lines it was judged on plus Jev's probabilities, not a written note, because Jev returns no text.

## Scoring and pattern logic

Each item gets a performance percentile inside its own source and cohort, and a pattern counts as "winning" only when it is clearly over-represented among top performers with enough examples behind it.

**Step 1: score within the source**

| Source | Performance signal | Cohort |
| --- | --- | --- |
| Creative Center | CTR tier, likes, rank position, budget tier | Same region, industry, objective, period |
| TikTok organic | Views relative to the account's median (outlier ratio), share rate | Same account, then same keyword |
| Commercial Content Library | Reach band, days running | Same advertiser |
| Own ads | Hook rate, CPI or CPA, ROAS | Same campaign objective |

Each item becomes a percentile (0 to 100) inside its cohort. Top quartile = "top performer".

**Step 2: find patterns**

For every label and every pair of labels (for example hook = price_shock with format = creator_ugc), compare its share among top performers vs the whole cohort:

```latex
\text{lift} = \frac{\text{share among top performers}}{\text{share in all items}}
```

**Step 3: gate it**

- Minimum 8 top-performer examples and 2 distinct advertisers, so one brand's style is not mistaken for a pattern.
- Lift of 1.3 or more to be flagged as winning, below 0.7 flagged as "avoid".
- Each pattern shows sample size, advertisers, sources and its 3 best example links.
- Confidence label: strong (seen in 2+ sources), medium (1 source, large sample), early (meets the minimum only).

**Step 4: compare objectives**

Run the same analysis separately for app_install and purchase, then list the patterns whose lift differs most between the two. That table is the direct answer to "what should an install asset do differently from a purchase asset".

## Supabase data model

Eleven tables in Postgres plus one Storage bucket for keyframes; raw videos are processed and deleted, never stored long term. Full SQL: `supabase/migrations/`.

| Table | Key columns | Purpose |
| --- | --- | --- |
| `team_members` | email, display_name, added_at | Allowlist behind every RLS policy |
| `watchlists` | id, name, type (advertiser, keyword, hashtag, account, industry), value, source, region, objective, active, refresh_cadence | What to collect |
| `runs` | id, source, watchlist_id, status, items_requested, items_done, cost_estimate_usd, spend_cap_usd, cost_actual_usd, pause_requested, started_at, finished_at, error | Job tracking, pause and resume, spend cap |
| `run_items` | run_id, item_id, position, stage, status, attempts, error, stage_log, cost_usd | Status per item per stage, live wall and Replay timeline |
| `items` | id, source, source_url, external_id, advertiser, account_handle, region, industry, objective_source, posted_at, collected_at, duration_s, thumbnail_url, raw_json | One row per ad or video |
| `metrics` | item_id, metric_name, value, value_text, unit, captured_at | Source metrics, kept raw and never blended |
| `media` | item_id, video_hash, width, height, scene_cuts[], audio_type, transcript, transcript_lang, transcript_segments, frames_json, ocr_text, vision_model, vision_version, keyframe_paths[] | Processing outputs, including the vision pass |
| `classifications` | item_id, video_hash, model, prompt_version, vision_version, labels_json, evidence_json, confidence, needs_review, corrections_json, reviewed_by, created_at | Taxonomy output, versioned |
| `scores` | item_id, cohort_key, percentile, is_top | Within-source performance |
| `patterns` | id, period, objective, region, label_combo, direction, lift, top_count, advertiser_count, sources[], confidence, example_ids[] | Aggregated findings |
| `briefs` | id, title, period, objective_scope, content_md, pattern_ids[], model, created_by, created_at | Generated production briefs |

**Conventions**

- Row Level Security on every table, access limited to Supabase Auth users whose email is in `team_members`.
- `prompt_version` (taxonomy) and `vision_version` on classifications, so changing either never silently mixes old and new labels.
- A unique index on (source, external_id) prevents duplicate collection.
- Keyframes in Storage under `frames/{item_id}/{second}.webp`, signed URLs only.

## Dashboard

Six screens on Vercel, built in Next.js with the same components and Apple-style design system used across your internal tools.

| Screen | What it shows | Key interactions |
| --- | --- | --- |
| Collect | Watchlists, run history, live progress, cost so far | Add watchlist, paste links, start, pause, resume, set spend cap |
| Library | Thumbnail wall of every item with its labels and percentile | Filter by source, objective, region, advertiser, any label; open original ad; correct a label |
| Patterns | Ranked winning and avoid patterns, with lift, sample size, confidence and 3 example thumbnails | Toggle objective, period, region; drill into examples |
| Install vs Purchase | The two objectives side by side, sorted by the biggest differences | Click any row to see examples from both sides |
| Timing | Distributions of seconds to reveal (app, product, price, offer), CTA timing and duration, per objective | Hover to see the items behind each bar |
| Brief | Generated production brief with edit, regenerate and export | Pick patterns to include, export to Markdown, PDF or Claude Doc |

**Item detail view**: keyframe strip (0 to 3s at 1 fps, then every 3s), transcript with hook, setup, demo, offer and CTA passages highlighted, the vision pass description and on-screen text per frame, all labels with their evidence (frames, transcript lines, confidence), source metrics and the link to the original.

**Animated views (Creator Lab style)**: the dashboard should feel alive, like the Creator Lab demo, because these views double as the screen recordings you share with the team.

| View | Behavior | Build notes |
| --- | --- | --- |
| Live run wall | Thumbnails pop into a grid as items are collected, then label chips (hook, format, objective) fade in as each classification lands | Supabase Realtime on `items`, `run_items` and `classifications`, Motion (Framer Motion) for enter and layout animations |
| Performance map | Scatter of every item: x = a chosen label or seconds-to-reveal, y = percentile. Dots fly to their position as scores arrive | D3 scales rendered in SVG, or canvas above 2,000 dots |
| Synced wall and map | Hover or filter on one highlights the same items in the other; filtering a hook makes the rest dim | Shared selection state in one store (Zustand) |
| Pattern reveal | Winning patterns slide in ranked by lift, with their 3 example thumbnails expanding beside them | Staggered list animation |
| Replay mode | Replays a finished run from saved data at a chosen speed, with no API calls, for clean screen recording | Same as Creator Lab: animates saved results, not the real pipeline speed |

Motion respects the system's reduced-motion setting, and every animated view also works as a static view.

## Production brief generator

The brief is the product: one click turns the selected patterns into a document the creative teams can shoot from, with every recommendation traced to real examples.

**Brief structure (fixed template)**

1. Executive summary: the 5 findings that matter most, each with its sample size.
2. For App Install, produce these: formats, hooks, structure, timing rules, CTA rules.
3. For Purchase, produce these: same fields, plus offer and price rules.
4. What changes between the two: the biggest differences table.
5. Pattern cards, one per finding: Pattern, Example (links), Why it works, Objective, How we adapt it.
6. Concept templates: 5 to 10 ready-to-brief concepts with a scene-by-scene script (0 to 3s, 3 to 8s, 8 to 15s, CTA), shot list, on-screen text, sound and language.
7. Testing matrix: variables to test first, cells, budget split, success metric per objective.
8. Team handoff: which concepts go to VCC, Motion and Design.

**How it is generated**

- The brief provider (Gemini free tier first, swappable to Claude) receives only structured data: pattern rows, example labels and their evidence. No raw scraped text, so the brief stays grounded.
- Brand context is a fixed input block: Wasal's categories, tone, languages, current offers and do-not-use rules, edited once in settings.
- Every claim in the brief cites its pattern ID; the dashboard can show the examples behind any line.
- Exports: Markdown, PDF, and a Claude Doc for team comments.

## Costs and guardrails

Content Lab targets free tiers first: Supabase Free, Vercel Hobby, Apify free credit, and the Groq and Gemini free tiers. The only paid AI line is Jev, which has no free tier but costs a fraction of a cent per video. All figures below are approximate and must be checked against each provider's current pricing and free-tier limits before launch, as they change often.

| Cost line | Driver | Approximate cost | Control |
| --- | --- | --- | --- |
| Apify collection | Items scraped per run | Pay per result, varies by actor, drawn from the free monthly credit | Per-run spend cap, like Creator Lab |
| Worker (Apify actor) | FFmpeg processing time | Compute units from the same free credit | Batch jobs, auto-stop when idle |
| Groq transcription | Minutes of audio | Free tier | Skip music-only audio, request pacer |
| Gemini vision pass | Keyframes per video | Free tier | Cache by video hash, request pacer |
| Jev classification | Input tokens per video | About $0.042 per million input tokens, so well under a cent per video; no free tier | Cache by video hash |
| Gemini brief writing | One call per brief | Free tier | None needed |
| Supabase | Database, Storage, Auth | Free plan | WebP keyframes, delete raw video after processing |
| Vercel | Dashboard hosting | Hobby plan | None needed |

**Free-tier limits to watch**

| Layer | Free option | Limit to watch |
| --- | --- | --- |
| Database, storage, login | Supabase Free plan | Database and storage caps (WebP keyframes keep each ad to a few hundred KB), projects pause after a week of inactivity |
| Dashboard | Vercel Hobby | Hobby is for non-commercial use; a Wasal-owned tool should move to Pro or Netlify |
| Collection + worker | Apify Free plan monthly credit | Credit covers pilot runs only, not a monthly 500-video sweep |
| Transcription | Groq free tier | Rate limits per minute and per day |
| Vision pass + brief writing | Gemini API free tier | Rate limits per minute and per day. Free-tier data may be used to improve Google's models: fine for public ads, never for Wasal's own ad data, so Phase 3 moves these calls to a paid provider such as Claude |
| Classification | TypeSafe Jev | No free tier; the one paid AI line |

Trade-off: every AI provider sits behind one interface in `packages/core`, so Content Lab starts on free tiers and switches the vision pass or brief writing to Claude for higher quality, or for Phase 3 data, without a rewrite.

**Guardrails**

- A per-run spend cap is required for every run. The estimate per provider and the cap are shown before the run starts, free-tier calls count as zero, and the worker stops before an item would push paid costs (Apify, Jev) over the cap. A monthly cap can follow once scheduled sweeps run.
- Only public content; no logins, no private accounts, no personal data on viewers or commenters.
- Store links, keyframes and labels, not full re-hosted videos. Original creators keep the content; the tool keeps the analysis.
- Source labels visible everywhere, so scraped organic data is never presented as official ad data.
- API keys in Supabase secrets or Vercel environment variables, never in the repo.
- Follow each platform's terms; if a scraping route is blocked, fall back to manual link import and the official libraries.

## Build phases

Phase 3 is the one that matters to the business: everything before it exists to make the generated brief trustworthy.

> Diagram: Build roadmap, 4 phases, 3 gates (kept in the original doc)

Phase 1 deliberately starts with manual link import, so the classification quality can be judged on hand-picked ads before any scraping cost is spent. Durations depend on your build time, so set dates once Phase 1 scope is approved.

## Claude Code kickoff prompt

Paste this into Claude Code in an empty repo to start Phase 1; it builds the skeleton and the manual-import path first, so the pipeline is testable before any scraping is wired.

````markdown
You are building Content Lab, an internal tool that analyzes top TikTok ads and organic videos and turns winning creative patterns into production briefs.

Reference: study https://github.com/artemnovitckii/creator-lab for pipeline ideas (collection, transcription, classification, caching, pause/resume). Do not copy its local-only architecture.

STACK
- Monorepo with pnpm workspaces: apps/web (Next.js App Router, TypeScript, Tailwind), apps/worker (Node 22 + FFmpeg, Dockerfile, deployable as an Apify actor), packages/core (shared types, taxonomy, Zod schemas, scoring).
- Supabase Free plan: Postgres, Storage, Auth (email magic link), RLS on all tables.
- Providers: Apify (collection; the worker also runs as an Apify actor), Groq Whisper (transcription), Gemini API free tier (vision pass and brief writing, swappable to Claude), TypeSafe Jev (classification). Every AI provider sits behind one interface in packages/core.
- Scope: TikTok only. Sources: tiktok_creative_center, tiktok_organic, tiktok_commercial_library (phase 2), tiktok_own_ads (phase 3). Keep `source` generic text.
- Web on Vercel Hobby. Target free tiers first. Secrets only in env vars. Never commit .env.

PHASE 1 SCOPE (build only this)
1. Supabase migrations for: team_members, watchlists, runs, run_items, items, metrics, media, classifications, scores, patterns, briefs. Unique index on (source, external_id). RLS policies limited to team members. Seed the first-sweep watchlists (Morocco, MENA, France; Temu, Shein, AliExpress in any region).
2. packages/core/taxonomy.ts: the label sets for objective, hook_type, hook_channel, format, structure, reveal timings, commercial_levers, social_proof, execution, language, cta, talent. Export a Zod schema for one classification record with confidence and evidence per field. Include prompt_version.
3. Manual import: a web form that accepts pasted TikTok or Creative Center URLs, creates items and a run, shows the cost estimate and requires a per-run spend cap.
4. Worker job (Apify actor): download video, extract audio and keyframes (every 1s for 0-3s, then every 3s) with FFmpeg, upload frames to Storage, transcribe with Groq, delete the raw video.
5. Classification in two calls behind the packages/core AI interface: (a) vision pass on the keyframes (Gemini free tier) returns a scene description per frame plus all on-screen text; (b) Jev (see creator-lab lib/schema.mjs and https://docs.typesafe.ai/api) classifies transcript + vision text into the taxonomy, output validated by the Zod schema. Must work with an empty transcript (music-only ads). Retry once on validation failure. Cache by video hash.
6. Library screen: thumbnail grid with filters on any label, item detail view with keyframe strip, transcript and labels.
6b. Animated UI in the spirit of the Creator Lab demo (study its public/ folder): a live run wall where thumbnails pop in and label chips fade in as classifications land (Supabase Realtime + Motion), a performance map scatter (D3 in SVG) synced with the wall through shared selection state (Zustand), and a Replay mode that animates a saved run from the database with no API calls, for screen recording. Respect prefers-reduced-motion.
7. A `doctor` script that checks every env var and provider key, like Creator Lab.

RULES
- Labels are assigned before any metric is joined.
- Unknown stays null. Never invent metrics.
- Every item keeps source, source_url and collected_at.
- Show estimated cost before every run and enforce a per-run spend cap.
- Write tests with mocked provider responses; no paid calls in tests.

Start by proposing the repo structure and the migration SQL, wait for my approval, then build step by step and commit after each step.
````

## Open decisions

Status of the five choices to settle before Phase 1 starts.

| Decision | Options | Status |
| --- | --- | --- |
| Where the worker runs | Custom Apify actor, Railway or Fly.io, local machine | Decided: Apify actor. Already in your stack, billed per run, no server to maintain |
| Classification model | Claude for everything, or a vision model plus Jev | Decided: Gemini free tier for the vision pass, TypeSafe Jev for classification. Claude stays a config switch for the vision pass and brief writing |
| Who uses it | Ossama only, marketing team, creative teams too | Recommended: marketing team with logins; creative teams receive the brief, not the dashboard |
| Owner and budget | Personal project, Wasal tool with a monthly budget line | Decided for now: free tiers first (see Costs), with a per-run spend cap; decide ownership before scheduled sweeps outgrow them |
| Name | Content Lab, or another name | Recommended: keep Content Lab as the working name |

- [x] Confirm the competitor watchlist for the first sweep: Morocco, MENA, France, plus Temu, Shein and AliExpress in any region
- [ ] Confirm Creative Center offers Morocco as a region filter
- [ ] Create a TypeSafe account and API key (Jev has no free tier) and a Gemini API key (free tier)
- [ ] Pick 10 known strong TikTok ads to test classification quality by hand
- [ ] Request TikTok Marketing API access for Wasal's ad account (needed for Phase 3)
