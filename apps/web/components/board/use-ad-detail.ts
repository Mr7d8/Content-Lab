'use client';

import { useEffect, useState } from 'react';
import type { BoardAd } from '@/lib/board-view';
import { missingImages, type AdDetail } from '@/lib/frame-view';
import { captureFrames } from './capture';

export type CaptureState = { status: 'idle' | 'running' | 'done' | 'failed'; error: string | null };

type State = { key: string | null; detail: AdDetail | null; error: string | null; capture: CaptureState };

const IDLE: CaptureState = { status: 'idle', error: null };

// Loaded details by ad and decode, so going back to an ad is instant.
const cache = new Map<string, AdDetail>();
// Decodes whose frames this tab already tried to capture.
const tried = new Set<string>();

const keyOf = (ad: BoardAd | null) => (ad && ad.decode.status !== 'running' ? `${ad.id}:${ad.decode.status}:${ad.decode.at ?? ''}` : null);

async function saveFrames(adId: string, frames: Map<number, Blob>, signal: AbortSignal): Promise<Record<string, string>> {
  const form = new FormData();
  for (const [second, blob] of frames) form.append(String(second), blob, `${second}.jpg`);
  const res = await fetch(`/api/ads/${adId}/frames`, { method: 'POST', body: form, signal });
  const body = (await res.json().catch(() => null)) as { ok: boolean; images?: Record<string, string>; message?: string } | null;
  if (!body?.ok || !body.images) throw new Error(body?.message ?? `Could not save the frames (HTTP ${res.status})`);
  return body.images;
}

// The open ad's frame by frame data. When the decode described frames that
// have no image yet and the video link still works, the frames are drawn
// from the video once and saved, so they stay after the link expires.
export function useAdDetail(ad: BoardAd | null): { detail: AdDetail | null; loading: boolean; error: string | null; capture: CaptureState } {
  const key = keyOf(ad);
  const id = ad?.id ?? null;
  const [state, setState] = useState<State>({ key: null, detail: null, error: null, capture: IDLE });

  useEffect(() => {
    if (!key || !id) return;
    const cached = cache.get(key);
    if (cached) {
      setState({ key, detail: cached, error: null, capture: IDLE });
      return;
    }
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/ads/${id}/detail`, { signal: ctrl.signal });
        const body = (await res.json().catch(() => null)) as { ok: boolean; detail?: AdDetail; message?: string } | null;
        if (!body?.ok || !body.detail) throw new Error(body?.message ?? `Could not load the frames (HTTP ${res.status})`);
        cache.set(key, body.detail);
        setState({ key, detail: body.detail, error: null, capture: IDLE });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setState({ key, detail: null, error: (e as Error).message, capture: IDLE });
      }
    })();
    return () => ctrl.abort();
  }, [key, id]);

  const detail = state.key === key ? state.detail : null;
  const missing = detail ? missingImages(detail.frames, detail.images) : [];
  const wantsCapture = !!detail && detail.capturable && missing.length > 0;

  useEffect(() => {
    if (!wantsCapture || !detail || !id || !key || tried.has(key)) return;
    tried.add(key);
    const ctrl = new AbortController();
    setState((s) => (s.key === key ? { ...s, capture: { status: 'running', error: null } } : s));
    void (async () => {
      try {
        const frames = await captureFrames(id, missing, ctrl.signal);
        if (!frames.size) throw new Error('No frame could be drawn from the video');
        const images = await saveFrames(id, frames, ctrl.signal);
        const next = { ...detail, images: { ...detail.images, ...images } };
        cache.set(key, next);
        setState((s) => (s.key === key ? { ...s, detail: next, capture: { status: 'done', error: null } } : s));
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          // Left before it finished: try again next time the ad opens.
          tried.delete(key);
          return;
        }
        setState((s) => (s.key === key ? { ...s, capture: { status: 'failed', error: (e as Error).message } } : s));
      }
    })();
    return () => ctrl.abort();
    // detail and missing stay the same for a key until the capture lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsCapture, id, key]);

  return {
    detail,
    loading: !!key && state.key !== key,
    error: state.key === key ? state.error : null,
    capture: state.key === key ? state.capture : IDLE,
  };
}
