// Shared HTTP helpers for provider calls: retries on rate limits and server
// errors, honours Retry-After, and never echoes API keys in error messages.

export class ProviderError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    detail = '',
  ) {
    const hint =
      status === 401 || status === 403
        ? 'Check the API key and account access.'
        : status === 429
          ? 'Rate limit reached; resume after the limit resets.'
          : 'Request failed.';
    super(`${service}: HTTP ${status}. ${hint}${detail ? ` ${detail}` : ''}`);
    this.name = 'ProviderError';
  }

  // Auth errors stop the whole run: every later call would fail the same way.
  get stopsRun(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type RequestOptions = {
  service: string;
  retries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  beforeAttempt?: () => Promise<void>;
  onRateLimit?: (waitMs: number) => void;
  secrets?: string[];
};

function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.replaceAll(secret, '[redacted]');
  return out.replace(/(?:gsk_|apify_api_|sk-ant-|AIza)[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 400);
}

export async function request(url: string, init: RequestInit, options: RequestOptions): Promise<Response> {
  const { service, retries = 3, timeoutMs = 90000, fetchImpl = fetch, sleep = delay, secrets = [] } = options;
  for (let attempt = 0; ; attempt++) {
    await options.beforeAttempt?.();
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      if (attempt >= retries) throw new Error(`${service}: connection failed or timed out`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res;

    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
      detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? '');
    } catch {
      // Non-JSON error body.
    }
    detail = redact(detail, secrets);

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const header = res.headers.get('retry-after');
      const seconds = header === null ? Number.NaN : Number(header);
      const wait = Number.isFinite(seconds) ? seconds * 1000 : 1000 * 2 ** attempt;
      if (wait > 60000) throw new ProviderError(service, res.status, detail);
      if (res.status === 429) options.onRateLimit?.(wait);
      await sleep(Math.max(500, wait));
      continue;
    }
    throw new ProviderError(service, res.status, detail);
  }
}
