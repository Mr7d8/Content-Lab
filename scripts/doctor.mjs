// Checks everything Content Lab needs, like Creator Lab's doctor.
//
//   pnpm run doctor            presence checks only, no network
//   pnpm run doctor --online   also calls free metadata endpoints (no paid calls)
//
// Reads .env and apps/web/.env.local. Never prints key values.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const online = process.argv.includes('--online');
const root = new URL('../', import.meta.url);

async function load(path) {
  try {
    return parseEnv(await readFile(new URL(path, root), 'utf8'));
  } catch {
    return {};
  }
}
const worker = { ...(await load('.env')) };
const web = { ...(await load('apps/web/.env.local')) };
const env = (name, scope = worker) => scope[name] || process.env[name] || '';

let failures = 0;
let warnings = 0;
const line = (status, name, hint = '') => console.log(`${status.padEnd(7)} ${name}${hint ? `: ${hint}` : ''}`);
const check = (name, ok, hint) => {
  line(ok ? 'OK' : 'MISSING', name, ok ? '' : hint);
  if (!ok) failures++;
};
const warn = (name, ok, hint) => {
  line(ok ? 'OK' : 'WARN', name, ok ? '' : hint);
  if (!ok) warnings++;
};

console.log('\nRuntime');
const [major, minor] = process.versions.node.split('.').map(Number);
check('Node.js 22.12+', major > 22 || (major === 22 && minor >= 12), 'Install Node 22 LTS or newer.');
const ffmpeg = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
warn('FFmpeg (local worker only)', ffmpeg.status === 0, 'Install FFmpeg to run pnpm worker:dev locally. The Apify image already has it.');
if (ffmpeg.status === 0) warn('FFmpeg WebP encoder', /libwebp/.test(ffmpeg.stdout), 'Keyframes fall back to JPEG, which uses more Supabase storage.');
warn('ffprobe (local worker only)', spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0, 'Comes with FFmpeg.');

console.log('\nDashboard (apps/web/.env.local or Vercel)');
check('NEXT_PUBLIC_SUPABASE_URL', Boolean(env('NEXT_PUBLIC_SUPABASE_URL', web)), 'Supabase > Project settings > API > Project URL.');
check('NEXT_PUBLIC_SUPABASE_ANON_KEY', Boolean(env('NEXT_PUBLIC_SUPABASE_ANON_KEY', web)), 'Supabase > Project settings > API > anon / publishable key.');
warn('APIFY_TOKEN (dashboard)', Boolean(env('APIFY_TOKEN', web)), 'Without it the dashboard cannot start the worker; runs wait for pnpm worker:dev.');
warn('APIFY_WORKER_ACTOR_ID', Boolean(env('APIFY_WORKER_ACTOR_ID', web)), 'Set after pushing the worker actor, e.g. yourname~content-lab-worker.');
warn('CRON_SECRET', Boolean(env('CRON_SECRET', web)), 'Without it Vercel Cron cannot start the daily research sweep.');
// The dashboard hands these to the worker on every start (Apify secret input).
for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'TYPESAFE_API_KEY']) {
  warn(`${name} (passed to the worker)`, Boolean(env(name, web)), 'Set it in Vercel so the worker receives it, or on the Apify actor instead.');
}
for (const name of Object.keys(web).filter((k) => k.startsWith('NEXT_PUBLIC_') && /SERVICE_ROLE|SECRET|API_KEY|TOKEN/.test(k))) {
  check(name, false, 'Secrets must not start with NEXT_PUBLIC_: that ships them to the browser.');
}

console.log('\nWorker (.env locally; on Apify the dashboard passes these)');
check('SUPABASE_URL', Boolean(env('SUPABASE_URL')), 'Same Project URL as the dashboard.');
check('SUPABASE_SERVICE_ROLE_KEY', Boolean(env('SUPABASE_SERVICE_ROLE_KEY')), 'Supabase > Project settings > API > service_role key. Worker only.');
check('APIFY_TOKEN', Boolean(env('APIFY_TOKEN')), 'Apify > Settings > API & Integrations. Injected automatically on Apify.');
line('OK', 'APIFY_CREATIVE_CENTER_ACTOR_ID', env('APIFY_CREATIVE_CENTER_ACTOR_ID') ? '' : 'not set, using fetch_cat~tiktok-ads-library-scraper');
check('GROQ_API_KEY', Boolean(env('GROQ_API_KEY')), 'console.groq.com > API Keys (free tier).');
const vision = (env('VISION_PROVIDER') || 'gemini').toLowerCase();
const brief = (env('BRIEF_PROVIDER') || 'gemini').toLowerCase();
check('VISION_PROVIDER / BRIEF_PROVIDER', ['gemini', 'claude'].includes(vision) && ['gemini', 'claude'].includes(brief), 'Use gemini or claude.');
if (vision === 'gemini' || brief === 'gemini') check('GEMINI_API_KEY', Boolean(env('GEMINI_API_KEY')), 'aistudio.google.com > Get API key (free tier).');
if (vision === 'claude' || brief === 'claude') check('ANTHROPIC_API_KEY', Boolean(env('ANTHROPIC_API_KEY')), 'console.anthropic.com > API keys.');
check('TYPESAFE_API_KEY', Boolean(env('TYPESAFE_API_KEY')), 'typesafe.ai account > API keys. Jev has no free tier.');

async function probe(name, url, headers, okStatuses = [200]) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const ok = okStatuses.includes(res.status);
    line(ok ? 'OK' : 'FAIL', name, ok ? '' : `HTTP ${res.status}`);
    if (!ok) failures++;
    return res;
  } catch (error) {
    line('FAIL', name, error.name === 'TimeoutError' ? 'timed out' : 'could not connect');
    failures++;
    return null;
  }
}

if (online) {
  console.log('\nProviders (free metadata calls only)');
  const supabaseUrl = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL', web);
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl && service) {
    const auth = { apikey: service, Authorization: `Bearer ${service}` };
    await probe('Supabase: migrations applied (runs table)', `${supabaseUrl}/rest/v1/runs?select=id&limit=1`, auth);
    const team = await probe('Supabase: team allowlist', `${supabaseUrl}/rest/v1/team_members?select=email`, auth);
    if (team?.ok) warn('Supabase: at least one team member', (await team.json()).length > 0, 'Add your email to public.team_members in the SQL editor.');
    await probe('Supabase: frames bucket', `${supabaseUrl}/storage/v1/bucket/frames`, auth);
  }
  if (env('APIFY_TOKEN')) {
    const auth = { Authorization: `Bearer ${env('APIFY_TOKEN')}` };
    await probe('Apify: token', 'https://api.apify.com/v2/users/me', auth);
    await probe('Apify: TikTok scraper actor', `https://api.apify.com/v2/acts/${encodeURIComponent(env('APIFY_TIKTOK_ACTOR_ID') || 'clockworks~tiktok-scraper')}`, auth);
    const workerId = env('APIFY_WORKER_ACTOR_ID', web) || env('APIFY_WORKER_ACTOR_ID');
    if (workerId) await probe('Apify: worker actor', `https://api.apify.com/v2/acts/${encodeURIComponent(workerId)}`, auth);
  }
  if (env('GROQ_API_KEY')) await probe('Groq: key', 'https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${env('GROQ_API_KEY')}` });
  if (env('GEMINI_API_KEY')) {
    const model = env('GEMINI_MODEL') || 'gemini-flash-latest';
    await probe(`Gemini: key and model ${model}`, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { 'x-goog-api-key': env('GEMINI_API_KEY') });
  }
  if (env('TYPESAFE_API_KEY')) await probe('Jev: key', 'https://api.typesafe.ai/v1/models', { Authorization: `Bearer ${env('TYPESAFE_API_KEY')}` });
  if (env('ANTHROPIC_API_KEY')) line('INFO', 'Claude', 'key present; it is checked on the first vision or brief call.');
}

console.log('');
if (failures) {
  console.log(`${failures} item(s) to fix${warnings ? `, ${warnings} warning(s)` : ''}. See docs/SETUP.md.`);
} else {
  console.log(`Ready${warnings ? ` with ${warnings} warning(s)` : ''}. ${online ? 'Keys reach their providers; a 3-link pilot run is the final check.' : 'Run pnpm run doctor --online to check keys against providers.'}`);
}
console.log('Key values are never printed.');
process.exitCode = failures ? 1 : 0;
