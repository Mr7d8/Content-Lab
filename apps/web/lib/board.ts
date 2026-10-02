import 'server-only';
import type { Tables } from '@content-lab/core';
import type { ServerClient } from './supabase/server';
import { toBoardAd, type BoardAd } from './board-view';

export type BoardSummary = { id: string; name: string; source: string; ads: number; lastScan: string | null };

export type ScanState = { id: string; status: string; synced: number; error: string | null; startedAt: string | null; finishedAt: string | null };

export type BoardData = {
  board: Tables<'watchlists'>;
  ads: BoardAd[];
  scan: ScanState | null;
  boards: BoardSummary[];
  spend: { month: number; cap: number; sweepsEnabled: boolean };
};

export async function listBoards(supabase: ServerClient): Promise<BoardSummary[]> {
  const { data } = await supabase.from('watchlists').select('id, name, source, last_swept_at, board_items(count)').order('name');
  return (data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    source: w.source,
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
  const [{ data: board }, { data: members }, { data: scan }, boards, { data: settings }, { data: spend }] = await Promise.all([
    supabase.from('watchlists').select('*').eq('id', boardId).maybeSingle(),
    supabase.from('board_items').select('rank, item:items(*)').eq('watchlist_id', boardId),
    supabase.from('runs').select('id, status, synced_count, error, started_at, finished_at')
      .eq('watchlist_id', boardId).eq('kind', 'scan').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    listBoards(supabase),
    supabase.from('app_settings').select('monthly_spend_cap_usd, sweeps_enabled').maybeSingle(),
    supabase.rpc('month_spend_usd'),
  ]);
  if (!board) return null;

  const rows = (members ?? []).flatMap((m) => (m.item ? [{ rank: m.rank, item: m.item as unknown as Tables<'items'> }] : []));
  const ids = rows.map((r) => r.item.id);
  const [{ data: classes }, { data: media }] = ids.length
    ? await Promise.all([
      supabase.from('classifications').select('item_id, labels_json, created_at').in('item_id', ids).order('created_at', { ascending: false }),
      supabase.from('media').select('item_id, breakdown_json, transcript').in('item_id', ids),
    ])
    : [{ data: [] }, { data: [] }];
  const latestClass = new Map<string, NonNullable<typeof classes>[number]>();
  for (const c of classes ?? []) if (!latestClass.has(c.item_id)) latestClass.set(c.item_id, c);
  const mediaById = new Map((media ?? []).map((m) => [m.item_id, m]));

  const now = new Date();
  return {
    board,
    ads: rows.map(({ rank, item }) => toBoardAd(item, rank, latestClass.get(item.id) ?? null, mediaById.get(item.id) ?? null, now)),
    scan: scan ? { id: scan.id, status: scan.status, synced: scan.synced_count, error: scan.error, startedAt: scan.started_at, finishedAt: scan.finished_at } : null,
    boards,
    spend: {
      month: Number(spend ?? 0),
      cap: Number(settings?.monthly_spend_cap_usd ?? 5),
      sweepsEnabled: settings?.sweeps_enabled ?? true,
    },
  };
}
