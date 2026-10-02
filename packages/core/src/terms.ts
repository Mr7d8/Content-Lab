// A board's search can hold several terms, separated by commas (Latin or
// Arabic) or new lines: "maroc, livraison gratuite, الدفع عند الاستلام". The
// scrapers take them as lists.

export const MAX_TERMS = 10;
export const MAX_TERM_LENGTH = 60;

const SEPARATORS = /[,،\n]+/;

// The board's terms, cleaned and de-duplicated (case-insensitive), at most
// MAX_TERMS. Hashtags lose their #, accounts their @.
export function searchTerms(value: string, type: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(SEPARATORS)) {
    let term = raw.trim().replace(/\s+/g, ' ');
    if (type === 'hashtag') term = term.replace(/^#+/, '');
    if (type === 'account') term = term.replace(/^@+/, '');
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.slice(0, MAX_TERMS);
}

// How terms are stored in watchlists.value.
export const joinTerms = (terms: string[]): string => terms.join(', ');

// "maroc, livraison gratuite +8" for titles and labels.
export function termsLabel(terms: string[], shown = 2): string {
  if (terms.length <= shown) return terms.join(', ');
  return `${terms.slice(0, shown).join(', ')} +${terms.length - shown}`;
}
