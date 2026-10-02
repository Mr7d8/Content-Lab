import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RATES } from '@content-lab/core';
import { createAIProviders } from '@content-lab/core/ai';
import { apifyDiscoverer } from './discover';
import { apifyResolver, type ApifyEnv } from './resolve';
import type { RunnerDeps } from './runner';
import { ALL_HANDLERS } from './stages';
import { supabaseStore } from './store';

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}. Set it in the dashboard's environment (Vercel), which passes it to the worker, or locally in .env (pnpm run doctor checks every key).`);
  return value;
}

// Wires the production dependencies from environment variables (Apify actor
// environment, or .env when run locally).
export function buildDeps(env: Env): RunnerDeps {
  const store = supabaseStore(required(env, 'SUPABASE_URL'), required(env, 'SUPABASE_SERVICE_ROLE_KEY'));
  const apify: ApifyEnv = {
    token: required(env, 'APIFY_TOKEN'),
    tiktokActorId: env.APIFY_TIKTOK_ACTOR_ID || 'clockworks~tiktok-scraper',
    // Discovery inputs are written for this actor; see docs/research-mode.md.
    creativeCenterActorId: env.APIFY_CREATIVE_CENTER_ACTOR_ID || 'fetch_cat~tiktok-ads-library-scraper',
  };
  return {
    store,
    resolver: apifyResolver(apify, DEFAULT_RATES.apifyPerItemUsd),
    discoverer: apifyDiscoverer(apify),
    ai: createAIProviders(env, ['transcriber', 'vision', 'classifier'] as const),
    handlers: ALL_HANDLERS,
    tmpRoot: join(tmpdir(), 'content-lab'),
    rates: DEFAULT_RATES,
  };
}
