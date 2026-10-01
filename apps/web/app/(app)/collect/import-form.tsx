'use client';

import { estimateRun, formatUsd, parseLink, sourceLabel, splitLinks, suggestCap } from '@content-lab/core';
import { useActionState, useMemo, useState } from 'react';
import { createImportRun, type ImportState } from './actions';

const initial: ImportState = { ok: false, message: '' };

export function ImportForm() {
  const [state, action, pending] = useActionState(createImportRun, initial);
  const [text, setText] = useState('');
  const [cap, setCap] = useState<string>('');

  // Client-side preview only; the server parses again and resolves short links.
  const preview = useMemo(() => {
    const links = splitLinks(text);
    const counts = new Map<string, number>();
    let shortLinks = 0;
    let invalid = 0;
    for (const link of links) {
      const parsed = parseLink(link);
      if (parsed.ok) counts.set(parsed.source, (counts.get(parsed.source) ?? 0) + 1);
      else if (parsed.shortLink) shortLinks++;
      else invalid++;
    }
    const usable = [...counts.values()].reduce((a, b) => a + b, 0) + shortLinks;
    return { counts, shortLinks, invalid, usable, estimate: estimateRun(usable) };
  }, [text]);

  const capValue = cap === '' ? suggestCap(preview.estimate.total) : Number(cap);
  const overCap = preview.usable > 0 && preview.estimate.total > capValue;

  return (
    <form action={action} className="card space-y-4 p-5">
      <div>
        <p className="eyebrow">Manual import</p>
        <h2 className="mt-0.5 text-lg font-semibold">Paste TikTok or Creative Center links</h2>
        <p className="text-sm text-sub">One per line. Videos already collected are reused, not paid for twice.</p>
      </div>

      <textarea
        name="links"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder={'https://www.tiktok.com/@brand/video/7301234567890123456\nhttps://ads.tiktok.com/business/creativecenter/topads/7299999999999999999/'}
        className="field font-mono text-xs leading-relaxed"
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {[...preview.counts].map(([source, n]) => (
          <span key={source} className="chip">
            {sourceLabel(source)} <strong>{n}</strong>
          </span>
        ))}
        {preview.shortLinks > 0 && <span className="chip">Short links <strong>{preview.shortLinks}</strong></span>}
        {preview.invalid > 0 && <span className="chip text-red">Not supported <strong>{preview.invalid}</strong></span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="rounded-[14px] bg-fill p-3 text-xs text-sub">
          <p className="font-semibold text-ink">
            Estimated cost {formatUsd(preview.estimate.total)} for {preview.usable} item{preview.usable === 1 ? '' : 's'}
          </p>
          <p className="mt-1">
            Apify {formatUsd(preview.estimate.lines.apify + preview.estimate.lines.worker)} · Jev {formatUsd(preview.estimate.lines.jev)} ·
            Groq and Gemini free tier. Estimates only; provider billing is authoritative.
          </p>
        </div>
        <label className="block text-xs text-sub">
          Spend cap (USD), required
          <input
            name="spend_cap_usd"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={cap === '' ? capValue.toFixed(2) : cap}
            onChange={(e) => setCap(e.target.value)}
            className="field mt-1 w-36"
          />
        </label>
      </div>

      {overCap && (
        <p className="text-xs text-orange">The estimate is above the cap: the run will stop once the cap is reached.</p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending || preview.usable === 0}>
          {pending ? 'Creating run...' : 'Start run'}
        </button>
        {state.message && (
          <p className={`text-sm ${state.ok ? 'text-sub' : 'text-red'}`} role="status">
            {state.message}
          </p>
        )}
      </div>

      {state.rejected && state.rejected.length > 0 && (
        <ul className="space-y-1 text-xs text-sub">
          {state.rejected.map((r) => (
            <li key={r.input} className="truncate">
              <span className="text-red">Skipped</span> {r.input}: {r.reason}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
