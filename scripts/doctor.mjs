// Checks everything Content Lab needs, like Creator Lab's doctor.
//
//   pnpm run doctor            presence checks only, no network
//   pnpm run doctor --online   also calls free metadata endpoints (no paid calls)
//
// Reads .env and apps/web/.env.local. Never prints key values.
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
// Everything runs in the dashboard now (Vercel in production).
const web = { ...(await load('.env')), ...(await load('apps/web/.env.local')) };
const env = (name) => web[name] || process.env[name] || '';

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

console.log('\nDashboard (apps/web/.env.local, or Vercel in production)');
check('NEXT_PUBLIC_SUPABASE_URL', Boolean(env('NEXT_PUBLIC_SUPABASE_URL')), 'Supabase > Project settings > API > Project URL.');
check('NEXT_PUBLIC_SUPABASE_ANON_KEY', Boolean(env('NEXT_PUBLIC_SUPABASE_ANON_KEY')), 'Supabase > Project settings > API > anon / publishable key.');
check('SUPABASE_SERVICE_ROLE_KEY', Boolean(env('SUPABASE_SERVICE_ROLE_KEY')), 'Supabase > Project settings > API > service_role key. Server only.');
check('APIFY_TOKEN', Boolean(env('APIFY_TOKEN')), 'Apify > Settings > API & Integrations. Scans run the scrapers with it.');
line('OK', 'APIFY_TIKTOK_ACTOR_ID', env('APIFY_TIKTOK_ACTOR_ID') ? '' : 'not set, using clockworks~tiktok-scraper');
check('GEMINI_API_KEY', Boolean(env('GEMINI_API_KEY')), 'aistudio.google.com > Get API key, with billing on. Decodes watch the whole video.');
check('TYPESAFE_API_KEY', Boolean(env('TYPESAFE_API_KEY')), 'typesafe.ai account > API keys. Jev tags each decoded ad.');
warn('CRON_SECRET', Boolean(env('CRON_SECRET')), 'Without it the daily scheduled scans do not run and Apify webhooks are not accepted (the open board still syncs).');
const brief = (env('BRIEF_PROVIDER') || 'gemini').toLowerCase();
check('BRIEF_PROVIDER', ['gemini', 'claude'].includes(brief), 'Use gemini or claude.');
if (brief === 'claude') check('ANTHROPIC_API_KEY', Boolean(env('ANTHROPIC_API_KEY')), 'console.anthropic.com > API keys.');
for (const name of Object.keys(web).filter((k) => k.startsWith('NEXT_PUBLIC_') && /SERVICE_ROLE|SECRET|API_KEY|TOKEN/.test(k))) {
  check(name, false, 'Secrets must not start with NEXT_PUBLIC_: that ships them to the browser.');
}

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
  const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL');
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl && service) {
    const auth = { apikey: service, Authorization: `Bearer ${service}` };
    await probe('Supabase: migrations applied (board_items table)', `${supabaseUrl}/rest/v1/board_items?select=item_id&limit=1`, auth);
    const team = await probe('Supabase: team allowlist', `${supabaseUrl}/rest/v1/team_members?select=email`, auth);
    if (team?.ok) warn('Supabase: at least one team member', (await team.json()).length > 0, 'Add your email to public.team_members in the SQL editor.');
    await probe('Supabase: covers bucket', `${supabaseUrl}/storage/v1/bucket/covers`, auth);
  }
  if (env('APIFY_TOKEN')) {
    const auth = { Authorization: `Bearer ${env('APIFY_TOKEN')}` };
    await probe('Apify: token', 'https://api.apify.com/v2/users/me', auth);
    await probe('Apify: Creative Center scraper', 'https://api.apify.com/v2/acts/automation_craft~tiktok-creative-center-scraper', auth);
    await probe('Apify: TikTok scraper', `https://api.apify.com/v2/acts/${encodeURIComponent(env('APIFY_TIKTOK_ACTOR_ID') || 'clockworks~tiktok-scraper')}`, auth);
  }
  if (env('GEMINI_API_KEY')) {
    const model = env('GEMINI_MODEL') || 'gemini-flash-latest';
    await probe(`Gemini: key and model ${model}`, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { 'x-goog-api-key': env('GEMINI_API_KEY') });
  }
  if (env('TYPESAFE_API_KEY')) await probe('Jev: key', 'https://api.typesafe.ai/v1/models', { Authorization: `Bearer ${env('TYPESAFE_API_KEY')}` });
  if (env('ANTHROPIC_API_KEY')) line('INFO', 'Claude', 'key present; it is checked on the first brief call.');
}

console.log('');
if (failures) {
  console.log(`${failures} item(s) to fix${warnings ? `, ${warnings} warning(s)` : ''}. See docs/SETUP.md.`);
} else {
  console.log(`Ready${warnings ? ` with ${warnings} warning(s)` : ''}. ${online ? 'Keys reach their providers; scanning a board and decoding one ad is the final check.' : 'Run pnpm run doctor --online to check keys against providers.'}`);
}
console.log('Key values are never printed.');
process.exitCode = failures ? 1 : 0;
