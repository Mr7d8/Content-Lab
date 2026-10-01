import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { alignToFrames, VISION_SYSTEM, visionUserText } from '../prompts/vision';
import { VisionOutput } from '../vision';
import type { TextWriter, VisionProvider } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

// Refusals re-run on a fallback model chosen by refusal category, inside the same call.
const fallback = () => ({ betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const });

type ImageMime = 'image/webp' | 'image/jpeg' | 'image/png' | 'image/gif';

function client(apiKey: string, fetchImpl?: typeof fetch) {
  return new Anthropic({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}

export function claudeVision(apiKey: string, { model = DEFAULT_CLAUDE_MODEL, fetchImpl }: { model?: string; fetchImpl?: typeof fetch } = {}): VisionProvider {
  const anthropic = client(apiKey, fetchImpl);
  return {
    name: `claude:${model}`,
    async describeFrames(frames, context) {
      const response = await anthropic.beta.messages.parse({
        ...fallback(),
        model,
        max_tokens: 16000,
        output_config: { effort: 'medium', format: betaZodOutputFormat(VisionOutput) },
        system: VISION_SYSTEM,
        messages: [{
          role: 'user',
          content: [
            ...frames.flatMap((f) => [
              { type: 'text' as const, text: `Keyframe at ${f.second}s:` },
              { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as ImageMime, data: Buffer.from(f.data).toString('base64') } },
            ]),
            { type: 'text' as const, text: visionUserText(frames, context) },
          ],
        }],
      });
      if (response.stop_reason === 'refusal') throw new Error(`Claude declined the vision pass (${response.stop_details?.category ?? 'no category'})`);
      if (!response.parsed_output) throw new Error('Claude returned no valid vision output');
      return {
        output: alignToFrames(response.parsed_output, frames),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
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
