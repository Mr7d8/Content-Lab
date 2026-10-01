// Cost estimates per item. These are estimates, not billing: check every rate
// against the provider's current pricing before relying on it.
export type Rates = {
  // Apify actor per result, including the video download (clockworks/tiktok-scraper).
  apifyPerItemUsd: number;
  // Apify compute units for the worker actor (FFmpeg and uploads), per item.
  workerPerItemUsd: number;
  // TypeSafe Jev, per million input tokens (no free tier).
  jevPerMillionInputTokensUsd: number;
  // Typical Jev request size: questions plus transcript and vision text.
  jevTokensPerItem: number;
  // Free tiers: Groq transcription and Gemini vision count as zero.
  groqPerItemUsd: number;
  visionPerItemUsd: number;
};

export const DEFAULT_RATES: Rates = {
  apifyPerItemUsd: 0.005,
  workerPerItemUsd: 0.002,
  jevPerMillionInputTokensUsd: 0.042,
  jevTokensPerItem: 9000,
  groqPerItemUsd: 0,
  visionPerItemUsd: 0,
};

export type CostLines = { apify: number; worker: number; jev: number; groq: number; vision: number };

export function itemCost(rates: Rates = DEFAULT_RATES): CostLines {
  return {
    apify: rates.apifyPerItemUsd,
    worker: rates.workerPerItemUsd,
    jev: (rates.jevTokensPerItem / 1_000_000) * rates.jevPerMillionInputTokensUsd,
    groq: rates.groqPerItemUsd,
    vision: rates.visionPerItemUsd,
  };
}

export const sumLines = (lines: CostLines) => lines.apify + lines.worker + lines.jev + lines.groq + lines.vision;

export function estimateRun(itemCount: number, rates: Rates = DEFAULT_RATES) {
  const perItem = itemCost(rates);
  const lines: CostLines = {
    apify: perItem.apify * itemCount,
    worker: perItem.worker * itemCount,
    jev: perItem.jev * itemCount,
    groq: perItem.groq * itemCount,
    vision: perItem.vision * itemCount,
  };
  return { itemCount, perItem: sumLines(perItem), lines, total: sumLines(lines) };
}

// Suggested cap: the estimate plus 50% headroom, rounded up to the next $0.50.
export function suggestCap(estimateUsd: number): number {
  return Math.max(0.5, Math.ceil((estimateUsd * 1.5) / 0.5) * 0.5);
}

// The worker starts an item only if its estimated cost still fits under the cap.
export function fitsUnderCap(spentUsd: number, nextItemUsd: number, capUsd: number): boolean {
  return spentUsd + nextItemUsd <= capUsd + 1e-9;
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
