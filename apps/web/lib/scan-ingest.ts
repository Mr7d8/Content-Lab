import { scannedAd, type Json, type ScannedAd, type Tables, type TablesInsert } from '@content-lab/core';

type Board = Pick<Tables<'watchlists'>, 'id' | 'type' | 'value' | 'source'>;

export type IngestPlan = {
  ads: ScannedAd[];
  items: TablesInsert<'items'>[];
  // Rank in the source's order for each external id.
  ranks: Map<string, number>;
};

// Turns one page of scraper rows into item rows. offset is the position of
// the page in the dataset, so ranks continue across pages. Rows the source
// does not recognize are skipped; a repeated ad keeps its first rank.
export function planIngest(board: Board, rows: Record<string, unknown>[], offset: number, now: string): IngestPlan {
  const ads: ScannedAd[] = [];
  const ranks = new Map<string, number>();
  rows.forEach((row, i) => {
    const ad = scannedAd(board.source, row);
    if (!ad || ranks.has(ad.externalId)) return;
    ranks.set(ad.externalId, ad.rank ?? offset + i + 1);
    ads.push(ad);
  });
  const items = ads.map((ad): TablesInsert<'items'> => ({
    source: ad.source,
    source_url: ad.sourceUrl,
    external_id: ad.externalId,
    advertiser: ad.advertiser ?? (board.type === 'advertiser' ? board.value : null),
    account_handle: ad.handle,
    region: ad.region,
    industry: ad.industry,
    objective_source: ad.objectiveSource,
    duration_s: ad.durationS && ad.durationS > 0 ? ad.durationS : null,
    posted_at: ad.postedAt,
    scan_json: ad.raw as Json,
    scanned_at: now,
  }));
  return { ads, items, ranks };
}

// Our final status for an Apify run that has ended.
export function scanOutcome(apifyStatus: string, statusMessage: string | null): { status: 'completed' | 'failed'; error: string | null } {
  if (apifyStatus === 'SUCCEEDED') return { status: 'completed', error: null };
  const reason = apifyStatus === 'TIMED-OUT' ? 'The scraper timed out' : apifyStatus === 'ABORTED' ? 'The scraper was stopped' : 'The scraper failed';
  return { status: 'failed', error: statusMessage ? `${reason}: ${statusMessage}` : reason };
}
