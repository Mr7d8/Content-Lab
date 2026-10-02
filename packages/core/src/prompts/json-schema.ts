import { z } from 'zod';

// JSON Schema for providers that take one (Gemini responseJsonSchema).
export function providerJsonSchema(type: z.ZodType): Record<string, unknown> {
  const schema = z.toJSONSchema(type) as Record<string, unknown>;
  delete schema.$schema;
  return stripHugeMaximum(schema) as Record<string, unknown>;
}

function stripHugeMaximum(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripHugeMaximum);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'maximum' && v === Number.MAX_SAFE_INTEGER) continue;
      out[k] = stripHugeMaximum(v);
    }
    return out;
  }
  return node;
}
