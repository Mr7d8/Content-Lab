import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_RATES } from '@content-lab/core';
import { createAIProviders } from '@content-lab/core/ai';
import { apifyResolver } from './resolve';
import type { RunnerDeps } from './runner';
import { MEDIA_HANDLERS } from './stages';
import { supabaseStore } from './store';

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}. Run pnpm doctor to check every key.`);
  return value;
}

// Wires the production dependencies from environment variables (Apify actor
// environment, or .env when run locally).
export function buildDeps(env: Env): RunnerDeps {
  const store = supabaseStore(required(env, 'SUPABASE_URL'), required(env, 'SUPABASE_SERVICE_ROLE_KEY'));
  const resolver = apifyResolver(
    {
      token: required(env, 'APIFY_TOKEN'),
      tiktokActorId: env.APIFY_TIKTOK_ACTOR_ID || 'clockworks~tiktok-scraper',
      creativeCenterActorId: env.APIFY_CREATIVE_CENTER_ACTOR_ID || null,
    },
    DEFAULT_RATES.apifyPerItemUsd,
  );
  return {
    store,
    resolver,
    ai: createAIProviders(env),
    handlers: { ...MEDIA_HANDLERS },
    tmpRoot: join(tmpdir(), 'content-lab'),
    rates: DEFAULT_RATES,
  };
}
