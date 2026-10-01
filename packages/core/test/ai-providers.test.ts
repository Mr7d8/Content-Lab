import { describe, expect, it, vi } from 'vitest';
import { claudeVision, createAIProviders, geminiVision, jevClassifier, parseJevAnswers } from '../src/ai';
import { buildQuestions } from '../src/classify';
import { frame } from './fixtures';

const frames = [
  { second: 0, mimeType: 'image/webp', data: new Uint8Array([1, 2, 3]) },
  { second: 1, mimeType: 'image/webp', data: new Uint8Array([4, 5, 6]) },
];
const context = { source: 'tiktok_organic', advertiser: 'temu', caption: null, durationS: 12 };
const visionJson = { frames: [frame(5, { product: true }), frame(9, { price: true }, { on_screen_text: ['9,99 €'] })] };

describe('gemini vision', () => {
  it('sends every keyframe inline with a JSON schema and pins seconds to the input frames', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify(visionJson) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 700, candidatesTokenCount: 300 },
    }));
    const vision = geminiVision('AIzaTEST', { model: 'gemini-test', fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await vision.describeFrames(frames, context);
    expect(vision.name).toBe('gemini:gemini-test');
    expect(result.output.frames.map((f) => f.second)).toEqual([0, 1]);
    expect(result.inputTokens).toBe(700);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaTEST');
    const body = JSON.parse(String(init.body));
    const images = body.contents[0].parts.filter((p: { inlineData?: unknown }) => p.inlineData);
    expect(images).toEqual([
      { inlineData: { mimeType: 'image/webp', data: 'AQID' } },
      { inlineData: { mimeType: 'image/webp', data: 'BAUG' } },
    ]);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.$schema).toBeUndefined();
    expect(JSON.stringify(body.generationConfig.responseJsonSchema)).not.toContain('9007199254740991');
  });

  it('rejects a frame count mismatch and blocked prompts', async () => {
    const one = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ frames: [frame(0)] }) }] } }] }));
    await expect(geminiVision('k', { fetchImpl: one as unknown as typeof fetch }).describeFrames(frames, context)).rejects.toThrow('1 frames for 2 keyframes');
    const blocked = vi.fn(async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(geminiVision('k', { fetchImpl: blocked as unknown as typeof fetch }).describeFrames(frames, context)).rejects.toThrow('blocked');
  });
});

describe('claude vision', () => {
  it('uses structured output, base64 WebP images and default fallbacks', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(visionJson) }],
      stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
      usage: { input_tokens: 1500, output_tokens: 400 },
    }));
    const vision = claudeVision('sk-ant-test', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await vision.describeFrames(frames, context);
    expect(vision.name).toBe('claude:claude-opus-5-5');
    expect(result.output.frames[1]?.on_screen_text).toEqual(['9,99 €']);
    expect(result.output.frames.map((f) => f.second)).toEqual([0, 1]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/messages');
    const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.output_config.effort).toBe('medium');
    expect(body.output_config.format.type).toBe('json_schema');
    const images = body.messages[0].content.filter((b: { type: string }) => b.type === 'image');
    expect(images[0].source).toEqual({ type: 'base64', media_type: 'image/webp', data: 'AQID' });
  });

  it('surfaces refusals', async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [],
      stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: 'cyber', explanation: null },
      usage: { input_tokens: 10, output_tokens: 0 },
    }));
    await expect(claudeVision('k', { fetchImpl: fetchImpl as unknown as typeof fetch }).describeFrames(frames, context)).rejects.toThrow('declined');
  });
});

describe('jev', () => {
  const questions = buildQuestions();
  const answers = Object.fromEntries(Object.entries(questions).map(([k, q]) => {
    const choice = Object.keys(q.criteria)[0] as string;
    return [k, { type: 'choice', choice, confidence: 0.8, probabilities: { [choice]: 0.8 } }];
  }));

  it('sends typed choice questions with the state and parses every answer', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ model: 'jev-1.13.0', answers, usage: { input_tokens: 8200 } }));
    const jev = jevClassifier('ts_key', { fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await jev.answer({ context: 'x', transcript: '[No speech: music only]' }, questions);
    expect(result.inputTokens).toBe(8200);
    expect(result.answers.objective?.choice).toBe('app_install');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('jev-1.13.0');
    expect(body.state.transcript).toBe('[No speech: music only]');
    expect(body.questions.hook_type.type).toBe('choice');
  });

  it('rejects answers outside the criteria', () => {
    const bad = { ...answers, format: { type: 'choice', choice: 'tv_commercial', confidence: 0.9 } };
    expect(() => parseJevAnswers({ model: 'jev', answers: bad }, questions)).toThrow('Invalid or missing Jev answer: format');
  });
});

describe('createAIProviders', () => {
  it('builds only the requested capabilities and picks providers by env', () => {
    const ai = createAIProviders({ GEMINI_API_KEY: 'g', TYPESAFE_API_KEY: 't' }, ['vision', 'classifier']);
    expect(ai.vision.name).toBe('gemini:gemini-flash-latest');
    expect(ai.classifier.model).toBe('jev-1.13.0');
    const claude = createAIProviders({ VISION_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'a' }, ['vision']);
    expect(claude.vision.name).toBe('claude:claude-opus-5-5');
  });

  it('names the missing key', () => {
    expect(() => createAIProviders({}, ['classifier'])).toThrow('Missing TYPESAFE_API_KEY');
    expect(() => createAIProviders({ VISION_PROVIDER: 'openai' }, ['vision'])).toThrow('VISION_PROVIDER must be gemini or claude');
  });
});
