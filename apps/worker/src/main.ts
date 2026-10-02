import { envWithWorkerInput } from '@content-lab/core';
import { buildDeps } from './deps';
import { readActorInput } from './input';
import { runPipeline } from './runner';
import { runSweep } from './sweep';

// Apify actor entry. Input is { runId } for one run or { mode: "sweep" } for
// the daily sweep, both started by the dashboard, which also passes its keys
// and settings (secret fields arrive encrypted). Everything else comes from
// Supabase.
const input = await readActorInput(process.env);
const env = envWithWorkerInput(input, process.env);
if (input.mode === 'sweep') {
  await runSweep(buildDeps(env));
} else if (input.runId) {
  const outcome = await runPipeline(input.runId, buildDeps(env));
  console.log(`Finished: ${outcome}`);
} else {
  throw new Error('Actor input must be { "runId": "..." } or { "mode": "sweep" }');
}
