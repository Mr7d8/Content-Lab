import { describe, expect, it, vi } from 'vitest';
import { createPacer, groqTranscriber, isSpeech, parseGroqTranscript, ProviderError, request } from '../src/ai';

const verbose = {
  text: ' Salam, had l3rd ghir lyoum, livraison gratuite! ',
  language: 'arabic',
  segments: [
    { start: 0, end: 2.1, text: ' Salam, had l3rd ghir lyoum,', no_speech_prob: 0.02 },
    { start: 2.1, end: 3.4, text: ' livraison gratuite!', no_speech_prob: 0.05 },
  ],
};

describe('groq transcript parsing', () => {
  it('keeps text, language and timed segments', () => {
    const t = parseGroqTranscript(verbose);
    expect(t.text).toBe('Salam, had l3rd ghir lyoum, livraison gratuite!');
    expect(t.language).toBe('arabic');
    expect(t.segments[1]).toEqual({ start: 2.1, end: 3.4, text: 'livraison gratuite!', noSpeechProb: 0.05 });
    expect(isSpeech(t)).toBe(true);
  });

  it('treats music hallucinations and very short output as not speech', () => {
    expect(isSpeech(parseGroqTranscript({ text: 'Thank you.', segments: [] }))).toBe(false);
    expect(isSpeech(parseGroqTranscript({ text: '[Music]', segments: [] }))).toBe(false);
    expect(isSpeech(parseGroqTranscript({ text: 'oh yeah', segments: [] }))).toBe(false);
    expect(isSpeech(parseGroqTranscript({
      text: 'la la la la la la la la',
      segments: [{ start: 0, end: 5, text: 'la la la la la la la la', no_speech_prob: 0.9 }],
    }))).toBe(false);
  });
});

describe('groq transcriber', () => {
  it('posts audio as multipart with segment timestamps', async () => {
    const fetchImpl = vi.fn(async () => Response.json(verbose));
    const t = await groqTranscriber('gsk_test', { fetchImpl: fetchImpl as unknown as typeof fetch }).transcribe(new Uint8Array([1, 2, 3]));
    expect(t.segments).toHaveLength(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('response_format')).toBe('verbose_json');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
  });
});

describe('request', () => {
  it('retries rate limits using Retry-After, then succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const onRateLimit = vi.fn();
    const res = await request('https://x.test', {}, { service: 'X', fetchImpl, sleep, onRateLimit });
    expect(await res.json()).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(onRateLimit).toHaveBeenCalledWith(2000);
  });

  it('fails fast on auth errors and redacts keys', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: { message: 'Invalid key gsk_secret123' } }, { status: 401 }));
    const err = await request('https://x.test', {}, { service: 'Groq', fetchImpl, secrets: ['gsk_secret123'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.stopsRun).toBe(true);
    expect(err.message).not.toContain('gsk_secret123');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('pacer', () => {
  it('spaces request starts by the per-minute interval', async () => {
    let clock = 0;
    const waits: number[] = [];
    const pacer = createPacer(30, { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
    await Promise.all([pacer.wait(), pacer.wait(), pacer.wait()]);
    expect(waits).toEqual([2000, 2000]);
    pacer.cooldown(10000);
    await pacer.wait();
    expect(waits.at(-1)).toBe(10000);
  });
});
