import { parseArgs } from 'node:util';
import { buildDeps } from './deps';
import { runPipeline } from './runner';

// Local runner: pnpm worker:dev --run <run id>. Same code path as the actor.
const { values } = parseArgs({ options: { run: { type: 'string' } } });
if (!values.run) {
  console.error('Usage: pnpm worker:dev --run <run id>');
  process.exit(1);
}
const outcome = await runPipeline(values.run, buildDeps(process.env));
console.log(`Finished: ${outcome}`);
