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

## Architecture and stack

Content Lab reuses Brika's building blocks (Apify, Supabase, Vercel) and adds two new ones: Groq for transcription and the Claude API for vision-based classification and brief writing.

> Diagram: Content Lab architecture, 4 layers (kept in the original doc)

Heavy video work runs in a separate worker so the Vercel dashboard stays light; the dashboard also sends pasted links straight to the worker.

| Layer | Choice | Shared with Brika | Why |
| --- | --- | --- | --- |
| Collection | Apify actors + manual link import | Yes | Same billing, same account, known actors |
| Processing | Node worker with FFmpeg, packaged as an Apify actor | Apify | FFmpeg and long jobs do not fit Vercel functions |
| Transcription | Groq Whisper | No | Fast, cheap, handles French and Arabic; test Darija quality early |
| Classification + brief | Claude API with image input and JSON output | No | Reads keyframes and transcript together |
| Database + files + login | Supabase (Postgres, Storage, Auth) | Yes | Same tooling, RLS for team access |
| Dashboard | Next.js on Vercel | Yes | Same deploy flow |
| Analytics | Mixpanel (optional) | Yes | Track which briefs get generated and used |

## Data sources

TikTok is the only channel in scope for now: four TikTok sources, each kept in its own lane. Ad libraries are the backbone, organic TikTok is a supporting signal, and our own ads come last but carry the strongest evidence.

| Source | What it gives | Access route | Role | Phase |
| --- | --- | --- | --- | --- |
| TikTok Creative Center, Top Ads | Top ads by region, industry and objective (App Installs, Conversions, Traffic), with CTR tier, likes and budget tier | Apify actor on the public Creative Center pages, or manual link import | Backbone for both objectives | 1 |
| TikTok organic | Videos by keyword, hashtag or competitor account, with views, likes, shares, comments | Apify `clockworks/tiktok-scraper` (already in Brika's stack) | Organic formats that ads borrow | 1 |
| TikTok Commercial Content Library | Official ad archive for ads shown in the EU, useful for France | TikTok Commercial Content API (application required) | Official fallback if scraping is blocked | 2 |
| Wasal's own TikTok ads | Spend, CPI, CPA, ROAS, hook rate, completion rate per creative | TikTok Marketing API (Reporting) | Ground truth: what works for us | 3 |

**Collection rules**

- Every item keeps its source, collection date and original URL, so every finding links back to a real ad.
- Manual link import is always available: paste Creative Center or TikTok links and the pipeline processes them like any scraped item.
- Watchlists define what gets collected: competitor advertisers (Temu, Shein, AliExpress, Noon, Namshi, Jumia, Sephora and others), category keywords, regions (Morocco, MENA and France for the local benchmark, plus global e-commerce leaders such as Temu, Shein and AliExpress in any region for best-in-class creative) and objectives.
- Scheduled refresh: weekly for competitor watchlists, monthly for the full category sweep.

**Watch-outs**

- Creative Center metrics are tiers and ranks, not exact results. Rank within a source, never mix sources into one score.
- Other channels (Meta, YouTube Shorts) are out of scope for now. The `source` field keeps the model open to add them later without a schema change.
- Wasal's brief asks to prioritize public libraries over unofficial scraping. The dashboard labels every item by source so organic scraped data never passes as ad evidence.

## Processing pipeline

Each item passes seven stages, every stage is resumable, and a failed item never blocks the rest of the run.

1. **Collect**: the run pulls items from a watchlist or pasted links, writes them to `items` with source, URL and raw metadata, and skips anything already collected.
2. **Fetch media**: the worker downloads the video once to temporary storage and records duration and a video hash for caching.
3. **Extract**: FFmpeg pulls the audio track and keyframes at 0, 1, 2 and 3 seconds, then every 3 seconds to the end. Frames go to Supabase Storage, the raw video is deleted.
4. **Transcribe**: Groq Whisper returns text with timestamps and a detected language. Music-only audio is marked as such instead of failing, unlike Creator Lab.
5. **Read on-screen text**: the classification call reads overlays straight from the keyframes, so subtitles, prices and CTAs are captured even with no speech.
6. **Classify**: one Claude API call per item with keyframes, transcript and source context, returning a JSON record validated against the taxonomy schema, with evidence and confidence per label.
7. **Score and aggregate**: after the run, source metrics are joined, percentiles computed per cohort, and the `patterns` table rebuilt for the period.

**Reliability rules**

- Status per item per stage, so pause and resume pick up exactly where they stopped.
- One automatic retry per stage, then the item is flagged for review.
- Classification cache keyed on video hash plus prompt version.

## Ad taxonomy

Every video gets one structured record from a single Claude API call that sees the keyframes, the on-screen text and the transcript together. Fixed labels keep results comparable across months; every label also carries a short evidence note and a confidence score.

| Dimension | Labels (v1) | Why it matters for the brief |
| --- | --- | --- |
| Likely objective | app_install, purchase, hybrid, brand | Splits every finding by objective |
| Hook type (0 to 3s) | problem_statement, price_shock, unboxing, pov, reaction, before_after, question, bold_claim, transformation, trend_audio, curiosity_gap, testimonial_open | The first thing the team must get right |
| Hook channel | visual_only, text_overlay, spoken, combined | Tells Motion vs VCC where the hook lives |
| Format | creator_ugc, talking_head, screen_recording, app_walkthrough, product_demo, catalogue_carousel, haul, skit, green_screen, slideshow, motion_graphics | Maps directly to a production team |
| Structure | problem_solution, demo_benefit_cta, listicle, story_arc, comparison, offer_first, social_proof_stack | The script skeleton to brief |
| Reveal timing | seconds to first app UI, product, price, offer, logo | "How fast" answers for both objectives |
| Commercial levers | price_visible, discount, free_delivery, urgency, scarcity, bundle, cash_on_delivery, first_order_offer | Purchase asset checklist |
| Social proof | reviews_shown, order_count, creator_endorsement, ugc_montage, ratings, none | Trust signals worth testing |
| Execution | duration (s), cut count, cuts per 10s, subtitles, voiceover, music, trend sound, aspect ratio | Pacing and finishing specs |
| Language | darija, french, arabic_msa, english, mixed, none | Critical for Morocco and MENA |
| CTA | spoken or text, wording, first appearance (s), repeated or not | CTA timing and copy rules |
| Talent | creator gender, age bracket, number of people, face in first frame | Casting notes |

**Rules carried over from Creator Lab**

- The model labels the creative before any metric is joined, so performance cannot bias the tags.
- Unknown stays unknown: no guessed metrics, no forced labels.
- Classifications are cached by video hash, so a re-run never pays twice.
- A human can correct any label in the dashboard; corrections are stored and used as few-shot examples later.

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

Nine tables in Postgres plus one Storage bucket for keyframes; raw videos are processed and deleted, never stored long term.

| Table | Key columns | Purpose |
| --- | --- | --- |
| `watchlists` | id, name, type (advertiser, keyword, hashtag, account), value, region, objective, active, refresh_cadence | What to collect |
| `runs` | id, source, watchlist_id, status, items_requested, items_done, cost_estimate_usd, started_at, finished_at, error | Job tracking, pause and resume |
| `items` | id, source, source_url, external_id, advertiser, account_handle, region, industry, objective_source, posted_at, collected_at, duration_s, thumbnail_url, raw_json | One row per ad or video |
| `metrics` | item_id, metric_name, value, unit, captured_at | Source metrics, kept raw and never blended |
| `media` | item_id, transcript, transcript_lang, ocr_text, keyframe_paths[], audio_type, video_hash | Processing outputs |
| `classifications` | item_id, model, prompt_version, labels_json, evidence_json, confidence, reviewed_by, created_at | Taxonomy output, versioned |
| `scores` | item_id, cohort_key, percentile, is_top | Within-source performance |
| `patterns` | id, period, objective, label_combo, lift, top_count, advertiser_count, sources[], confidence, example_ids[] | Aggregated findings |
| `briefs` | id, period, objective_scope, content_md, pattern_ids[], created_by, created_at | Generated production briefs |

**Conventions**

- Row Level Security on every table, access limited to the team's Supabase Auth users.
- `prompt_version` on classifications, so changing the taxonomy never silently mixes old and new labels.
- A unique index on (source, external_id) prevents duplicate collection.
- Keyframes in Storage under `frames/{item_id}/{second}.jpg`, signed URLs only.

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

**Item detail view**: keyframe strip (0 to 3s at 1 fps, then every 3s), transcript with hook, setup, demo, offer and CTA passages highlighted, all labels with evidence notes, source metrics and the link to the original.

**Animated views (Creator Lab style)**: the dashboard should feel alive, like the Creator Lab demo, because these views double as the screen recordings you share with the team.

| View | Behavior | Build notes |
| --- | --- | --- |
| Live run wall | Thumbnails pop into a grid as items are collected, then label chips (hook, format, objective) fade in as each classification lands | Supabase Realtime on `items` and `classifications`, Motion (Framer Motion) for enter and layout animations |
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

- Claude API receives only structured data: pattern rows, example labels and evidence notes. No raw scraped text, so the brief stays grounded.
- Brand context is a fixed input block: Wasal's categories, tone, languages, current offers and do-not-use rules, edited once in settings.
- Every claim in the brief cites its pattern ID; the dashboard can show the examples behind any line.
- Exports: Markdown, PDF, and a Claude Doc for team comments.

## Costs and guardrails

The main variable cost is analysis per video, roughly a few US cents each, so a 500-video monthly sweep should stay well within a small monthly budget. All figures below are approximate and must be checked against each provider's current pricing before launch.

| Cost line | Driver | Approximate cost | Control |
| --- | --- | --- | --- |
| Apify collection | Items scraped per run | Pay per result, varies by actor | Per-run spend cap, like Creator Lab |
| Groq transcription | Minutes of audio | Fractions of a cent per short video | Skip music-only audio |
| Claude API classification | Keyframes + transcript per video | Around 2 to 5 cents per video | Cache by video hash, use a smaller model for re-runs |
| Claude API brief | One call per brief | Negligible | None needed |
| Supabase | Database, Storage, Auth | Free tier, then Pro plan | Delete raw video after processing |
| Vercel | Dashboard hosting | Hobby or existing Pro plan | None needed |
| Worker | FFmpeg processing time | Depends on host | Batch jobs, auto-stop when idle |

**Free-tier path**: Phases 1 and 2 can run at or near zero cost if classification uses a model with a free API tier; only Claude API has no free tier.

| Layer | Free option | Limit to watch |
| --- | --- | --- |
| Database, storage, login | Supabase Free plan | Database and storage caps, projects pause after inactivity |
| Dashboard | Vercel Hobby | Hobby is for non-commercial use; a Wasal-owned tool should move to Pro or Netlify |
| Collection + worker | Apify Free plan monthly credit | Credit covers small runs only, not a monthly 500-video sweep |
| Transcription | Groq free tier | Rate limits per minute and per day |
| Classification | Gemini API free tier (Flash models accept images) | Free-tier data may be used to improve Google's models; fine for public ads, not for Wasal's own ad data |
| Brief writing | Same model as classification | None at this volume |

Trade-off: keep the model provider behind one interface in `packages/core`, so Content Lab can start on a free model and switch to Claude for higher label quality without a rewrite. Check each provider's current free-tier limits before building, as they change often.

**Guardrails**

- Spend caps per run and per month, shown before every run starts.
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
- Supabase: Postgres, Storage, Auth (email magic link), RLS on all tables.
- Providers: Apify (collection), Groq Whisper (transcription), Claude API (classification and brief generation).
- Web on Vercel. Secrets only in env vars. Never commit .env.

PHASE 1 SCOPE (build only this)
1. Supabase migrations for: watchlists, runs, items, metrics, media, classifications, scores, patterns, briefs. Unique index on (source, external_id). RLS policies for authenticated users.
2. packages/core/taxonomy.ts: the label sets for objective, hook_type, hook_channel, format, structure, reveal timings, commercial_levers, social_proof, execution, language, cta, talent. Export a Zod schema for one classification record with evidence notes and confidence per field. Include prompt_version.
3. Manual import: a web form that accepts pasted TikTok or Creative Center URLs, creates items and a run.
4. Worker job: download video, extract audio and keyframes (every 1s for 0-3s, then every 3s) with FFmpeg, upload frames to Storage, transcribe with Groq, delete the raw video.
5. Classification: one Claude API call per item with keyframes + transcript + on-screen text, returning JSON validated by the Zod schema. Retry once on validation failure. Cache by video hash.
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

Five choices to settle before Phase 1 starts; the recommendation is listed first in each row.

| Decision | Options | Recommendation |
| --- | --- | --- |
| Where the worker runs | Custom Apify actor, Railway or Fly.io, local machine | Decided: Apify actor. Already in your stack, billed per run, no server to maintain |
| Classification model | Claude Sonnet for all, Claude Haiku for first pass + Sonnet for top performers | Start with Sonnet everywhere, then measure label agreement before switching |
| Who uses it | Ossama only, marketing team, creative teams too | Marketing team with logins; creative teams receive the brief, not the dashboard |
| Owner and budget | Personal project, Wasal tool with a monthly budget line | Build on free tiers first (see Costs), decide ownership before scheduled sweeps outgrow them |
| Name | Content Lab, or another name | Keep Content Lab as the working name |

- [ ] Confirm the competitor watchlist (advertisers and keywords) for the first sweep
- [ ] Pick 10 known strong TikTok ads to test classification quality by hand
- [ ] Request TikTok Marketing API access for Wasal's ad account (needed for Phase 3)
