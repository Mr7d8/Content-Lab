import { creativeCenterTermMatches, fitsObjective, metaPageMatches, scannedAd, searchTerms, type Json, type ScannedAd, type Tables, type TablesInsert } from '@content-lab/core';

type Board = Pick<Tables<'watchlists'>, 'id' | 'type' | 'value' | 'source' | 'objective'>;

export type IngestPlan = {
  ads: ScannedAd[];
  items: TablesInsert<'items'>[];
  // Rank in the source's order for each external id.
  ranks: Map<string, number>;
  // Ads left out because their objective is not the board's.
  offObjective: number;
  // Meta advertiser boards: ads left out because another page ran them.
  offPage: number;
  // Creative Center boards with words: ads left out for matching none.
  offTerms: number;
};

// Turns one page of scraper rows into item rows. offset is the position of
// the page in the dataset, so ranks continue across pages. Rows the source
// does not recognize are skipped, and so are ads run for another objective
// than the board's; a repeated ad keeps its first rank. terms: the words a
// Creative Center board keeps ads for (creativeCenterTerms), since its
// scraper cannot search by words.
export function planIngest(board: Board, rows: Record<string, unknown>[], offset: number, now: string, terms: string[] | null = null): IngestPlan {
  const ads: ScannedAd[] = [];
  const ranks = new Map<string, number>();
  let offObjective = 0;
  let offPage = 0;
  let offTerms = 0;
  const words = board.source === 'tiktok_creative_center' ? terms : null;
  const pages = board.source === 'meta_ad_library' && board.type === 'advertiser' ? searchTerms(board.value, board.type) : null;
  rows.forEach((row, i) => {
    const ad = scannedAd(board.source, row, new Date(now));
    if (!ad || ranks.has(ad.externalId)) return;
    if (!fitsObjective(board.objective, ad.objectiveSource)) {
      offObjective++;
      return;
    }
    if (pages && !metaPageMatches(ad, pages)) {
      offPage++;
      return;
    }
    if (words && !creativeCenterTermMatches(ad, words)) {
      offTerms++;
      return;
    }
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
  return { ads, items, ranks, offObjective, offPage, offTerms };
}

// Our final status for an Apify run that has ended.
export function scanOutcome(apifyStatus: string, statusMessage: string | null): { status: 'completed' | 'failed'; error: string | null } {
  if (apifyStatus === 'SUCCEEDED') return { status: 'completed', error: null };
  const reason = apifyStatus === 'TIMED-OUT' ? 'The scraper timed out' : apifyStatus === 'ABORTED' ? 'The scraper was stopped' : 'The scraper failed';
  return { status: 'failed', error: statusMessage ? `${reason}: ${statusMessage}` : reason };
}
