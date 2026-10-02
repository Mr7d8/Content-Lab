import { describe, expect, it } from 'vitest';
import { envWithWorkerInput, workerInputFromEnv } from '../src/worker-input';

describe('worker input', () => {
  it('passes the dashboard settings that are set, using the public Supabase URL', () => {
    expect(workerInputFromEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      GROQ_API_KEY: 'gsk_x',
      GEMINI_API_KEY: '',
      APIFY_TOKEN: 'apify_api_never_passed',
    })).toEqual({ supabaseUrl: 'https://abc.supabase.co', supabaseServiceRoleKey: 'service', groqApiKey: 'gsk_x' });
  });

  it('puts input settings over the actor environment and skips undecrypted values', () => {
    const env = envWithWorkerInput(
      { runId: 'r1', supabaseUrl: 'https://abc.supabase.co', groqApiKey: 'new', geminiApiKey: 'ENCRYPTED_VALUE:a:b' },
      { GROQ_API_KEY: 'old', GEMINI_API_KEY: 'actor', APIFY_TOKEN: 't' },
    );
    expect(env).toMatchObject({ SUPABASE_URL: 'https://abc.supabase.co', GROQ_API_KEY: 'new', GEMINI_API_KEY: 'actor', APIFY_TOKEN: 't' });
  });
});
