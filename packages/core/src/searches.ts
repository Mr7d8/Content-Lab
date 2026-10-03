import type { Json, Tables } from './db';
import { estimateScan } from './scan';
import { sourceLabel } from './sources';

// What a board searches. Most boards have one search, kept in their own
// columns; a combined board (made from several starters) lists its searches
// in watchlists.searches, and a scan runs each of them.

export type BoardSearch = {
  source: string;
  type: string;
  value: string;
  region: string | null;
  objective: string | null;
  period_days: number;
  moroccan_only: boolean;
};

type Board = Pick<Tables<'watchlists'>, 'source' | 'type' | 'value' | 'region' | 'objective' | 'period_days'> & { moroccan_only?: boolean; searches?: Json };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function readSearch(v: unknown): BoardSearch | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const source = str(o.source);
  const type = str(o.type);
  const value = str(o.value);
  if (!source || !type || !value) return null;
  return {
    source,
    type,
    value,
    region: str(o.region),
    objective: str(o.objective),
    period_days: typeof o.period_days === 'number' ? o.period_days : 30,
    moroccan_only: o.moroccan_only === true,
  };
}

export function boardSearches(board: Board): BoardSearch[] {
  const listed = Array.isArray(board.searches) ? board.searches.map(readSearch).filter((s): s is BoardSearch => s !== null) : [];
  if (listed.length) return listed;
  const { source, type, value, region, objective, period_days } = board;
  return [{ source, type, value, region, objective, period_days, moroccan_only: board.moroccan_only ?? false }];
}

// The sources a board's ads come from, in its searches' order.
export const boardSources = (board: Board): string[] => [...new Set(boardSearches(board).map((s) => s.source))];

// A scan of every search, each fetching up to the board's ads per scan.
export const boardScanEstimate = (board: Board & { max_items: number }): number =>
  boardSearches(board).reduce((sum, s) => sum + estimateScan(board.max_items, s.source), 0);

// "Meta Ad Library + TikTok Creative Center"
export const boardSourcesLabel = (board: Board): string => boardSources(board).map(sourceLabel).join(' + ');
