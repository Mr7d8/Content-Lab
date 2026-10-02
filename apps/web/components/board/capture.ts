'use client';

// Draws an ad's video at the given seconds and returns one JPEG per second.
// The video comes through our own origin (/api/ads/[id]/video), so the canvas
// may be read back. Seconds that fail to draw are left out.

const WIDTH = 360;
const STEP_TIMEOUT_MS = 10_000;

function once(target: HTMLVideoElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`The video did not answer (${event})`)), STEP_TIMEOUT_MS);
    const onEvent = () => done(null);
    const onError = () => done(new Error('The video could not be loaded'));
    const onAbort = () => done(new DOMException('Aborted', 'AbortError'));
    function done(error: Error | null) {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const toJpeg = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));

export async function captureFrames(adId: string, seconds: number[], signal: AbortSignal): Promise<Map<number, Blob>> {
  const out = new Map<number, Blob>();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = `/api/ads/${adId}/video`;
  // Kept in the page but out of sight: some mobile browsers only load videos
  // that are in the document.
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  try {
    const loaded = once(video, 'loadeddata', signal);
    video.load();
    // iOS only fetches video data once playback starts; muted play is allowed.
    void video.play().then(() => video.pause()).catch(() => undefined);
    await loaded;
    video.pause();
    const scale = WIDTH / (video.videoWidth || WIDTH);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = Math.round((video.videoHeight || WIDTH * (16 / 9)) * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw video frames');
    const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
    for (const second of seconds) {
      if (signal.aborted) break;
      // The very first frame is often black; the last moment may not exist.
      const t = Math.max(0.1, Math.min(second, duration - 0.1));
      try {
        const seeked = once(video, 'seeked', signal);
        video.currentTime = t;
        await seeked;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await toJpeg(canvas);
        if (blob) out.set(second, blob);
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
      }
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
  return out;
}
