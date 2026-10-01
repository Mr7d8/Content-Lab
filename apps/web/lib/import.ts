import { parseLink, resolveShortLink, splitLinks, type ParsedLink, type SourceId } from '@content-lab/core';

export const MAX_LINKS_PER_RUN = 200;

export type AcceptedLink = { input: string; source: SourceId; externalId: string; url: string; handle: string | null; region: string | null };
export type RejectedLink = { input: string; reason: string };

// Parse pasted text into supported, de-duplicated links. Short links are resolved
// with the given resolver (network on the server, mocked in tests).
export async function prepareLinks(
  text: string,
  resolve: (input: string) => Promise<ParsedLink> = (input) => resolveShortLink(input),
): Promise<{ accepted: AcceptedLink[]; rejected: RejectedLink[] }> {
  const inputs = splitLinks(text);
  const accepted: AcceptedLink[] = [];
  const rejected: RejectedLink[] = [];
  const seen = new Set<string>();

  for (const [index, input] of inputs.entries()) {
    if (index >= MAX_LINKS_PER_RUN) {
      rejected.push({ input, reason: `Only ${MAX_LINKS_PER_RUN} links per run` });
      continue;
    }
    let parsed = parseLink(input);
    if (!parsed.ok && parsed.shortLink) {
      try {
        parsed = await resolve(input);
      } catch {
        parsed = { ok: false, input, reason: 'Short link could not be resolved' };
      }
    }
    if (!parsed.ok) {
      rejected.push({ input, reason: parsed.reason });
      continue;
    }
    const key = `${parsed.source}:${parsed.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({ input, source: parsed.source, externalId: parsed.externalId, url: parsed.url, handle: parsed.handle, region: parsed.region });
  }
  return { accepted, rejected };
}
