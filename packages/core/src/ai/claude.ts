import Anthropic from '@anthropic-ai/sdk';
import type { TextWriter } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

// Refusals re-run on a fallback model chosen by refusal category, inside the same call.
const fallback = () => ({ betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const });

function client(apiKey: string, fetchImpl?: typeof fetch) {
  return new Anthropic({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

export function claudeWriter(apiKey: string, { model = DEFAULT_CLAUDE_MODEL, fetchImpl }: { model?: string; fetchImpl?: typeof fetch } = {}): TextWriter {
  const anthropic = client(apiKey, fetchImpl);
  return {
    name: `claude:${model}`,
    async write({ system, user, maxTokens = 64000 }) {
      // Streaming keeps long briefs clear of HTTP timeouts.
      const response = await anthropic.beta.messages.stream({
        ...fallback(),
        model,
        max_tokens: maxTokens,
        output_config: { effort: 'high' },
        system,
        messages: [{ role: 'user', content: user }],
      }).finalMessage();
      if (response.stop_reason === 'refusal') throw new Error(`Claude declined to write the brief (${response.stop_details?.category ?? 'no category'})`);
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    },
  };
}
