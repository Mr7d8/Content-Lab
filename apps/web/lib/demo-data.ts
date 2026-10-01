import {
  type ClassificationRecord,
  FORMAT,
  HOOK_CHANNEL,
  HOOK_TYPE,
  labelText,
  STRUCTURE,
} from '@content-lab/core';
import { type RunView, type RunViewItem, withPercentiles } from './run-view';

// Synthetic run for rehearsing the animated views without keys or real data.
// Advertisers are fictional; nothing here is a real analysis.
const ADVERTISERS = ['Souk Express', 'Moda Casa', 'Atlas Shop', 'Bazar Fly', 'Dar Beauty', 'Cartly', 'Medina Market', 'Riad Home'];
const PALETTE = [['#ffd6e0', '#ff8fab'], ['#d7e3fc', '#7aa2f7'], ['#d8f3dc', '#52b788'], ['#fff1c1', '#f4a261'], ['#e9d8fd', '#9f7aea'], ['#cdeffd', '#38b2ac']];

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function thumb(i: number, hook: string, advertiser: string): string {
  const [a, b] = PALETTE[i % PALETTE.length] as [string, string];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="480" viewBox="0 0 270 480">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="270" height="480" fill="url(#g)"/>
<rect x="55" y="150" width="160" height="160" rx="28" fill="#fff" fill-opacity="0.55"/>
<circle cx="135" cy="230" r="44" fill="#fff" fill-opacity="0.8"/>
<text x="135" y="390" text-anchor="middle" font-family="-apple-system,Helvetica,Arial" font-size="20" font-weight="700" fill="#1d1d1f">${labelText(hook)}</text>
<text x="135" y="420" text-anchor="middle" font-family="-apple-system,Helvetica,Arial" font-size="15" fill="#1d1d1f" fill-opacity="0.7">${advertiser}</text>
<text x="18" y="36" font-family="-apple-system,Helvetica,Arial" font-size="13" font-weight="600" fill="#1d1d1f" fill-opacity="0.6">SYNTHETIC</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;

export function demoRunView(count = 32, seed = 7): RunView {
  const r = prng(seed);
  const t0 = Date.UTC(2026, 9, 1, 9, 0, 0);
  const hooks = Object.keys(HOOK_TYPE);
  const items: RunViewItem[] = Array.from({ length: count }, (_, i) => {
    const objective = r() < 0.45 ? 'app_install' : r() < 0.85 ? 'purchase' : 'hybrid';
    const hook = pick(r, hooks.slice(0, 8));
    const advertiser = pick(r, ADVERTISERS);
    const priceAt = objective === 'purchase' ? Math.floor(r() * 4) : r() < 0.5 ? null : 3 + Math.floor(r() * 9);
    const labels: ClassificationRecord = {
      objective: objective as ClassificationRecord['objective'],
      hook_type: hook as ClassificationRecord['hook_type'],
      hook_channel: pick(r, Object.keys(HOOK_CHANNEL)) as ClassificationRecord['hook_channel'],
      format: pick(r, Object.keys(FORMAT).slice(0, 7)) as ClassificationRecord['format'],
      structure: pick(r, Object.keys(STRUCTURE)) as ClassificationRecord['structure'],
      reveal: {
        app_ui_s: objective === 'purchase' ? null : Math.floor(r() * 7),
        product_s: Math.floor(r() * 3),
        price_s: priceAt,
        offer_s: r() < 0.6 ? Math.floor(r() * 6) : null,
        logo_s: r() < 0.7 ? 6 + Math.floor(r() * 9) : null,
      },
      levers: r() < 0.6 ? ['price_visible', 'discount'] : ['free_delivery'],
      social_proof: r() < 0.3 ? ['ratings'] : [],
      execution: { duration_s: 12 + Math.floor(r() * 30), cut_count: 4 + Math.floor(r() * 14), cuts_per_10s: Math.round(r() * 60) / 10, subtitles: r() < 0.7, voiceover: r() < 0.4, music: r() < 0.5, trend_sound: r() < 0.3, aspect_ratio: '9:16' },
      language: pick(r, ['darija', 'french', 'arabic_msa', 'mixed'] as const),
      cta: { channel: 'text', wording: 'Shop now', first_s: 8 + Math.floor(r() * 12), repeated: r() < 0.4 },
      talent: { gender: pick(r, ['female', 'male', 'none'] as const), age_bracket: '25_34', people_count: 1, face_first_frame: r() < 0.6 },
      script: [],
    };
    // Fast price reveals and price shocks do a little better in this fake world.
    const boost = (hook === 'price_shock' ? 2.2 : 1) * (priceAt !== null && priceAt <= 1 ? 1.6 : 1);
    const views = Math.round(Math.exp(9 + r() * 3.5) * boost);
    const framed = t0 + i * 4200 + Math.floor(r() * 2000);
    return {
      id: `demo-${i}`,
      position: i,
      source: r() < 0.6 ? 'tiktok_creative_center' : 'tiktok_organic',
      advertiser,
      status: 'done',
      stage: 'done',
      thumb: thumb(i, hook, advertiser),
      labels,
      metric: { name: 'views', value: views },
      percentile: null,
      times: { collected: t0, framed, classified: framed + 6000 + Math.floor(r() * 5000) },
    };
  });
  return {
    run: { id: 'demo', status: 'completed', itemsRequested: count, itemsDone: count, itemsFailed: 0, costActual: 0, spendCap: 1, createdAt: new Date(t0).toISOString() },
    items: withPercentiles(items),
  };
}
