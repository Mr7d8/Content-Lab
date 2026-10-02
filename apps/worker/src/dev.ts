import { parseArgs } from 'node:util';
import { buildDeps } from './deps';
import { runPipeline } from './runner';
import { runSweep } from './sweep';

// Local runner, same code paths as the actor:
//   pnpm worker:dev --run <run id>
//   pnpm worker:dev --sweep
const { values } = parseArgs({ options: { run: { type: 'string' }, sweep: { type: 'boolean' } } });
if (values.sweep) {
  await runSweep(buildDeps(process.env));
} else if (values.run) {
  const outcome = await runPipeline(values.run, buildDeps(process.env));
  console.log(`Finished: ${outcome}`);
} else {
  console.error('Usage: pnpm worker:dev --run <run id>, or pnpm worker:dev --sweep');
  process.exit(1);
}
