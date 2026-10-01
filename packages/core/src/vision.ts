import { z } from 'zod';

// Bump when the vision prompt or this schema changes (media.vision_version).
export const VISION_VERSION = 'vision-v1';

// What the vision pass returns for one keyframe.
export const VisionFrame = z.object({
  second: z.number().nonnegative(),
  description: z.string(),
  on_screen_text: z.array(z.string()),
  // Exact wording of a call to action visible in this frame, if any.
  cta_text: z.string().nullable(),
  elements: z.object({
    app_ui: z.boolean(),
    product: z.boolean(),
    price: z.boolean(),
    offer: z.boolean(),
    logo: z.boolean(),
    cta: z.boolean(),
    subtitles: z.boolean(),
    faces: z.number().int().nonnegative(),
    people: z.number().int().nonnegative(),
  }),
});
export type VisionFrame = z.infer<typeof VisionFrame>;

export const VisionOutput = z.object({ frames: z.array(VisionFrame).min(1) });
export type VisionOutput = z.infer<typeof VisionOutput>;

// Keyframe schedule: every second for 0 to 3 s, then every 3 s to the end.
export function keyframeSeconds(durationS: number): number[] {
  if (!Number.isFinite(durationS) || durationS <= 0) return [0];
  const out: number[] = [];
  for (let s = 0; s <= 3 && s < durationS; s++) out.push(s);
  for (let s = 6; s < durationS; s += 3) out.push(s);
  return out;
}

// All on-screen text in frame order, de-duplicated (media.ocr_text).
export function joinOnScreenText(frames: VisionFrame[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const frame of [...frames].sort((a, b) => a.second - b.second)) {
    for (const raw of frame.on_screen_text) {
      const text = raw.trim();
      if (text && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        lines.push(text);
      }
    }
  }
  return lines.join('\n');
}
