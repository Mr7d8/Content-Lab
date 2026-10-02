// Settings the dashboard hands the worker in the actor input each time it
// starts it, so they live in one place: the dashboard's environment (Vercel).
// Secret fields are declared `isSecret` in apps/worker/.actor/input_schema.json,
// which makes Apify store them encrypted; the worker decrypts them on start.
export const WORKER_INPUT_FIELDS = {
  supabaseUrl: { env: 'SUPABASE_URL', secret: false },
  supabaseServiceRoleKey: { env: 'SUPABASE_SERVICE_ROLE_KEY', secret: true },
  groqApiKey: { env: 'GROQ_API_KEY', secret: true },
  geminiApiKey: { env: 'GEMINI_API_KEY', secret: true },
  typesafeApiKey: { env: 'TYPESAFE_API_KEY', secret: true },
  anthropicApiKey: { env: 'ANTHROPIC_API_KEY', secret: true },
  visionProvider: { env: 'VISION_PROVIDER', secret: false },
  geminiModel: { env: 'GEMINI_MODEL', secret: false },
  jevModel: { env: 'JEV_MODEL', secret: false },
  creativeCenterActorId: { env: 'APIFY_CREATIVE_CENTER_ACTOR_ID', secret: false },
} as const;

type Env = Record<string, string | undefined>;

// Dashboard side: the input fields for every setting that is set.
export function workerInputFromEnv(env: Env): Record<string, string> {
  const input: Record<string, string> = {};
  for (const [field, { env: name }] of Object.entries(WORKER_INPUT_FIELDS)) {
    const value = env[name] || (name === 'SUPABASE_URL' ? env.NEXT_PUBLIC_SUPABASE_URL : undefined);
    if (value) input[field] = value;
  }
  return input;
}

// Worker side: the environment with the input's settings on top, so the
// dashboard's values win over anything set on the actor itself. Values that
// are still encrypted (no key to decrypt them) are left out.
export function envWithWorkerInput(input: Record<string, unknown>, env: Env): Env {
  const out: Env = { ...env };
  for (const [field, { env: name }] of Object.entries(WORKER_INPUT_FIELDS)) {
    const value = input[field];
    if (typeof value === 'string' && value && !value.startsWith('ENCRYPTED_')) out[name] = value;
  }
  return out;
}
