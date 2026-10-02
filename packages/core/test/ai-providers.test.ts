import { describe, expect, it, vi } from 'vitest';
import { claudeWriter, createAIProviders, geminiDecoder, jevClassifier, parseJevAnswers } from '../src/ai';
import { buildQuestions } from '../src/classify';

describe('gemini', () => {
  it('surfaces blocked prompts and empty answers', async () => {
    const video = { data: new Uint8Array([1, 2, 3]), mimeType: 'video/mp4' };
    const context = { source: 'tiktok_creative_center', advertiser: null, caption: null, durationS: 2 };
    const blocked = vi.fn(async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(geminiDecoder('k', { fetchImpl: blocked as unknown as typeof fetch }).decode(video, [0, 1], context)).rejects.toThrow('blocked');
    const empty = vi.fn(async () => Response.json({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }));
    await expect(geminiDecoder('k', { fetchImpl: empty as unknown as typeof fetch }).decode(video, [0, 1], context)).rejects.toThrow('no content (MAX_TOKENS)');
  });
});

describe('claude writer', () => {
  it('surfaces refusals', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      [
        'event: message_start',
        `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })}`,
        '',
        'event: message_delta',
        `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'refusal', stop_sequence: null, stop_details: { type: 'refusal', category: 'cyber', explanation: null } }, usage: { output_tokens: 0 } })}`,
        '',
        'event: message_stop',
        `data: ${JSON.stringify({ type: 'message_stop' })}`,
        '',
        '',
      ].join('\n'),
      { headers: { 'content-type': 'text/event-stream' } },
    ));
    await expect(claudeWriter('k', { fetchImpl: fetchImpl as unknown as typeof fetch }).write({ system: 's', user: 'u' })).rejects.toThrow('declined');
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
    const ai = createAIProviders({ GEMINI_API_KEY: 'g', TYPESAFE_API_KEY: 't' }, ['decoder', 'classifier']);
    expect(ai.decoder.name).toBe('gemini:gemini-flash-latest');
    expect(ai.classifier.model).toBe('jev-1.13.0');
    const claude = createAIProviders({ BRIEF_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'a' }, ['briefWriter']);
    expect(claude.briefWriter.name).toBe('claude:claude-opus-5-5');
  });

  it('names the missing key', () => {
    expect(() => createAIProviders({}, ['classifier'])).toThrow('Missing TYPESAFE_API_KEY');
    expect(() => createAIProviders({}, ['decoder'])).toThrow('Missing GEMINI_API_KEY');
    expect(() => createAIProviders({ BRIEF_PROVIDER: 'openai' }, ['briefWriter'])).toThrow('BRIEF_PROVIDER must be gemini or claude');
  });
});
