import { buildDeps } from './deps';
import { runPipeline } from './runner';
import { runSweep } from './sweep';

type ActorInput = { runId?: string; mode?: string };

// Apify actor entry. Input is { runId } for one run (started by the
// dashboard) or { mode: "sweep" } for the daily sweep (started by an Apify
// Schedule); everything else comes from Supabase. Read without the Apify SDK
// to keep the image small: the platform injects the token and the default
// key-value store id that holds INPUT.
async function readActorInput(env: NodeJS.ProcessEnv): Promise<ActorInput> {
  if (env.CONTENT_LAB_RUN_ID) return { runId: env.CONTENT_LAB_RUN_ID };
  const store = env.ACTOR_DEFAULT_KEY_VALUE_STORE_ID ?? env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
  const key = env.ACTOR_INPUT_KEY ?? env.APIFY_INPUT_KEY ?? 'INPUT';
  if (!store || !env.APIFY_TOKEN) throw new Error('Not running on Apify: use pnpm worker:dev --run <id> locally');
  const res = await fetch(`https://api.apify.com/v2/key-value-stores/${store}/records/${key}`, {
    headers: { Authorization: `Bearer ${env.APIFY_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Could not read actor input (HTTP ${res.status})`);
  return (await res.json()) as ActorInput;
}

const input = await readActorInput(process.env);
if (input.mode === 'sweep') {
  await runSweep(buildDeps(process.env));
} else if (input.runId) {
  const outcome = await runPipeline(input.runId, buildDeps(process.env));
  console.log(`Finished: ${outcome}`);
} else {
  throw new Error('Actor input must be { "runId": "..." } or { "mode": "sweep" }');
}
