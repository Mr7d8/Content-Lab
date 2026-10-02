import { advertiserKeys, checkMarket, type MarketCheck, type MarketReason, type MarketVerdict, type ScannedAd } from '@content-lab/core';

// The Moroccan gate: which ads a "Moroccan ads only" board shows. Pure, so
// scans, the check step and the tests share it.

export type GateStatus = 'shown' | 'pending' | 'rejected';

export type AdvertiserEntry = { status: 'moroccan' | 'blocked'; name: string };
// The advertisers list, by key (brand:<name> or domain:<host>).
export type AdvertiserBook = Map<string, AdvertiserEntry>;

// What items.market_json holds: the verdict of the landing page and cover
// check, or the team's own call (manual).
export type StoredMarket = MarketCheck & {
  via: string[];
  manual?: boolean;
  landing_url?: string | null;
  landing_host?: string | null;
  cost_usd?: number;
  checked_at?: string;
};

const VERDICTS: readonly MarketVerdict[] = ['moroccan', 'elsewhere', 'unclear'];

export function readStoredMarket(json: unknown): StoredMarket | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!VERDICTS.includes(o.verdict as MarketVerdict)) return null;
  const reasons: MarketReason[] = Array.isArray(o.reasons)
    ? o.reasons.flatMap((r) => {
      const x = r as Record<string, unknown>;
      return x && typeof x.label === 'string' ? [{ label: x.label, examples: Array.isArray(x.examples) ? x.examples.filter((e): e is string => typeof e === 'string') : [] }] : [];
    })
    : [];
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    verdict: o.verdict as MarketVerdict,
    elsewhere: str(o.elsewhere),
    reasons,
    via: Array.isArray(o.via) ? o.via.filter((v): v is string => typeof v === 'string') : [],
    manual: o.manual === true,
    landing_url: str(o.landing_url),
    landing_host: str(o.landing_host),
    cost_usd: typeof o.cost_usd === 'number' ? o.cost_usd : undefined,
    checked_at: str(o.checked_at) ?? undefined,
  };
}

// The advertiser's entry for any of its keys; a block wins.
export function lookupAdvertiser(book: AdvertiserBook, keys: string[]): AdvertiserEntry | null {
  const entries = keys.map((k) => book.get(k)).filter((e): e is AdvertiserEntry => !!e);
  return entries.find((e) => e.status === 'blocked') ?? entries[0] ?? null;
}

export const statusFor = (verdict: MarketVerdict): GateStatus => (verdict === 'moroccan' ? 'shown' : 'rejected');

// One ad on a board. Order: the team's call on the ad, a blocked advertiser,
// a known Moroccan advertiser, the stored check, then the ad's own text
// (unclear text waits for the check).
export function gateStatus(
  ad: Pick<ScannedAd, 'caption' | 'advertiser'>,
  ctx: { moroccanOnly: boolean; book: AdvertiserBook; stored: StoredMarket | null },
): GateStatus {
  if (!ctx.moroccanOnly) return 'shown';
  const { stored } = ctx;
  if (stored?.manual) return statusFor(stored.verdict);
  const entry = lookupAdvertiser(ctx.book, advertiserKeys({ brand: ad.advertiser, landingHost: stored?.landing_host }));
  if (entry?.status === 'blocked') return 'rejected';
  if (entry?.status === 'moroccan') return 'shown';
  if (stored) return statusFor(stored.verdict);
  const text = checkMarket({ texts: [ad.caption, ad.advertiser] });
  return text.verdict === 'unclear' ? 'pending' : statusFor(text.verdict);
}

export function bookFrom(rows: { key: string; name: string; status: string }[]): AdvertiserBook {
  const book: AdvertiserBook = new Map();
  for (const r of rows) if (r.status === 'moroccan' || r.status === 'blocked') book.set(r.key, { status: r.status, name: r.name });
  return book;
}

// The team's call, recorded over the check: it wins, and keeps the check's
// landing page and reasons for reference.
export function markedMarket(stored: StoredMarket | null, verdict: 'moroccan' | 'elsewhere', at: string): StoredMarket & { marked_at: string } {
  const label = verdict === 'moroccan' ? 'Marked Moroccan by the team' : 'Marked not Moroccan by the team';
  return {
    verdict,
    elsewhere: verdict === 'elsewhere' ? 'Marked by the team' : null,
    reasons: [{ label, examples: [] }, ...(stored?.reasons ?? []).filter((r) => !r.label.startsWith('Marked '))].slice(0, 6),
    via: [...new Set([...(stored?.via ?? []), 'manual'])],
    manual: true,
    landing_url: stored?.landing_url ?? null,
    landing_host: stored?.landing_host ?? null,
    // The check's cost stays in the month it was spent.
    ...(stored?.cost_usd !== undefined ? { cost_usd: stored.cost_usd, checked_at: stored.checked_at } : {}),
    marked_at: at,
  };
}
