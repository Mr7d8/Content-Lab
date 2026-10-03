import 'server-only';
import { boardSourcesLabel, type Tables } from '@content-lab/core';
import type { ServerClient } from './supabase/server';
import { scanOfRuns, toBoardAd, type BoardAd } from './board-view';
import type { GateStatus } from './gate';

// sources: the board's sources, as shown ("Meta Ad Library + TikTok Creative Center").
export type BoardSummary = { id: string; name: string; sources: string; ads: number; lastScan: string | null };

// The latest scan, all its runs together (one per search). synced: the
// scrapers' rows read, out of requested. kept: the ads on the board seen by
// this scan; the other rows were left out on the way in.
export type ScanState = { id: string; runIds: string[]; status: string; synced: number; requested: number; kept: number; error: string | null; startedAt: string | null; finishedAt: string | null };

export type BoardData = {
  board: Tables<'watchlists'>;
  ads: BoardAd[];
  scan: ScanState | null;
  // Ads last seen before this (the start of the latest finished scan) are
  // from earlier scans; the board hides them unless asked.
  cutoff: string | null;
  // Moroccan boards: ads waiting for the check, and ads the gate left out.
  gate: { pending: number; rejected: number };
  boards: BoardSummary[];
  spend: { month: number; cap: number; sweepsEnabled: boolean };
};

export async function listBoards(supabase: ServerClient): Promise<BoardSummary[]> {
  const { data } = await supabase.from('watchlists').select('id, name, source, type, value, region, objective, period_days, searches, last_swept_at, board_items(count)').order('name');
  return (data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    sources: boardSourcesLabel(w),
    ads: (w.board_items as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
    lastScan: w.last_swept_at,
  }));
}

// The board to open by default: the one with the most ads, else the first.
export async function defaultBoardId(supabase: ServerClient): Promise<string | null> {
  const boards = await listBoards(supabase);
  return [...boards].sort((a, b) => b.ads - a.ads)[0]?.id ?? null;
}

export async function loadBoard(supabase: ServerClient, boardId: string): Promise<BoardData | null> {
  const [{ data: board }, { data: members }, { data: scan }, { data: finished }, boards, { data: settings }, { data: spend }] = await Promise.all([
    supabase.from('watchlists').select('*').eq('id', boardId).maybeSingle(),
    supabase.from('board_items').select('rank, last_seen_at, status, item:items(*)').eq('watchlist_id', boardId),
    supabase.from('runs').select('id, status, synced_count, items_requested, error, started_at, finished_at, batch_id')
      .eq('watchlist_id', boardId).eq('kind', 'scan').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('runs').select('started_at')
      .eq('watchlist_id', boardId).eq('kind', 'scan').eq('status', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    listBoards(supabase),
    supabase.from('app_settings').select('monthly_spend_cap_usd, sweeps_enabled').maybeSingle(),
    supabase.rpc('month_spend_usd'),
  ]);
  if (!board) return null;
  // A scan of several searches is the latest run with the others of its batch.
  const { data: batchRuns } = scan?.batch_id
    ? await supabase.from('runs').select('id, status, synced_count, items_requested, error, started_at, finished_at').eq('batch_id', scan.batch_id)
    : { data: null };
  const latest = scan ? scanOfRuns(batchRuns?.length ? batchRuns : [scan]) : null;

  const rows = (members ?? []).flatMap((m) => (m.item ? [{ rank: m.rank, seenAt: m.last_seen_at, gate: m.status as GateStatus, item: m.item as unknown as Tables<'items'> }] : []));
  const ids = rows.map((r) => r.item.id);
  const [{ data: classes }, { data: media }] = ids.length
    ? await Promise.all([
      supabase.from('classifications').select('item_id, labels_json, created_at').in('item_id', ids).order('created_at', { ascending: false }),
      supabase.from('media').select('item_id, breakdown_json, transcript, ocr_text, transcript_lang').in('item_id', ids),
    ])
    : [{ data: [] }, { data: [] }];
  const latestClass = new Map<string, NonNullable<typeof classes>[number]>();
  for (const c of classes ?? []) if (!latestClass.has(c.item_id)) latestClass.set(c.item_id, c);
  const mediaById = new Map((media ?? []).map((m) => [m.item_id, m]));

  const now = new Date();
  // An ad with no cover left (no saved copy, and the source's link expired)
  // stays off the board; a later scan that sees it again brings it back.
  const ads = rows
    .map(({ rank, seenAt, gate, item }) => ({ ...toBoardAd(item, rank, latestClass.get(item.id) ?? null, mediaById.get(item.id) ?? null, now), seenAt, gate }))
    .filter((ad) => ad.cover !== null);
  return {
    board,
    ads,
    cutoff: finished?.started_at ?? null,
    gate: { pending: ads.filter((a) => a.gate === 'pending').length, rejected: ads.filter((a) => a.gate === 'rejected').length },
    scan: scan && latest ? {
      ...latest,
      id: scan.batch_id ?? scan.id,
      kept: latest.startedAt ? rows.filter((r) => Date.parse(r.seenAt) >= Date.parse(latest.startedAt as string)).length : 0,
    } : null,
    boards,
    spend: {
      month: Number(spend ?? 0),
      cap: Number(settings?.monthly_spend_cap_usd ?? 5),
      sweepsEnabled: settings?.sweeps_enabled ?? true,
    },
  };
}
