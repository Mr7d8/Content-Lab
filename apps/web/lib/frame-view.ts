import { COMMERCIAL_LEVER, labelText, SOCIAL_PROOF, type BeatRole, type Breakdown, type ClassificationRecord, type VisionFrame } from '@content-lab/core';

// The frame by frame view of a decoded ad, computed from what the decode
// saved (media.frames_json, the speech segments, the beats) and the taxonomy
// labels. Pure, so the inspector and the tests share it.

export type Segment = { start: number; end: number; text: string };

// What the inspector loads when an ad is opened (GET /api/ads/[id]/detail):
// the decode's frames and speech, the saved frame images and the taxonomy record.
export type AdDetail = {
  frames: VisionFrame[];
  segments: Segment[];
  // Signed image URL per frame second ("3": "https://...").
  images: Record<string, string>;
  record: ClassificationRecord | null;
  // The scan's video link still works, so missing frame images can be captured.
  capturable: boolean;
};

export type FrameRow = {
  second: number;
  // Where the next described frame starts, or the end of the video.
  end: number;
  description: string;
  onScreen: string[];
  cta: string | null;
  // What the frame shows: product, price, offer and so on.
  elements: string[];
  // Speech that starts while this frame is the latest one.
  speech: string[];
  role: BeatRole | null;
  image: string | null;
};

const ELEMENTS: [keyof Omit<VisionFrame['elements'], 'faces' | 'people'>, string][] = [
  ['product', 'Product'],
  ['price', 'Price'],
  ['offer', 'Offer'],
  ['app_ui', 'App screen'],
  ['logo', 'Logo'],
  ['cta', 'CTA'],
  ['subtitles', 'Subtitles'],
];

function elementsOf(frame: VisionFrame): string[] {
  const out = ELEMENTS.filter(([key]) => frame.elements[key]).map(([, label]) => label);
  const people = frame.elements.people;
  if (people > 0) out.push(people === 1 ? '1 person' : `${people} people`);
  return out;
}

function roleAt(beats: Breakdown['beats'], second: number): BeatRole | null {
  const inside = beats.find((b) => b.start <= second && second < b.end);
  if (inside) return inside.role;
  const before = beats.filter((b) => b.start <= second);
  return before.at(-1)?.role ?? null;
}

export function frameRows(
  frames: VisionFrame[],
  context: { segments?: Segment[]; beats?: Breakdown['beats']; durationS?: number | null; images?: Record<string, string> } = {},
): FrameRow[] {
  const { segments = [], beats = [], durationS = null, images = {} } = context;
  const sorted = [...frames].sort((a, b) => a.second - b.second);
  const last = Math.max(durationS ?? 0, ...beats.map((b) => b.end), ...segments.map((s) => s.end), (sorted.at(-1)?.second ?? 0) + 1);
  return sorted.map((frame, i) => {
    const next = sorted[i + 1]?.second;
    const end = next ?? last;
    // Each line of speech shows once, on the frame it starts in.
    const speech = segments
      .filter((s) => (i === 0 || s.start >= frame.second) && (next === undefined || s.start < next))
      .map((s) => s.text.trim())
      .filter(Boolean);
    return {
      second: frame.second,
      end,
      description: frame.description,
      onScreen: frame.on_screen_text.map((t) => t.trim()).filter(Boolean),
      cta: frame.cta_text?.trim() || null,
      elements: elementsOf(frame),
      speech,
      role: roleAt(beats, frame.second),
      image: images[String(frame.second)] ?? null,
    };
  });
}

// The row the video is on at time t, or -1 before the first one.
export function activeRow(rows: FrameRow[], t: number): number {
  let found = -1;
  rows.forEach((r, i) => {
    if (r.second <= t + 0.05) found = i;
  });
  return found;
}

// Keyframes are stored as frames/{item_id}/{second}.webp or .jpg.
export function secondFromPath(path: string): number | null {
  const name = path.split('/').at(-1) ?? '';
  const second = Number(name.split('.')[0]);
  return name && Number.isFinite(second) && second >= 0 ? second : null;
}

// Seconds the decode described but that have no saved image yet.
export function missingImages(frames: Pick<VisionFrame, 'second'>[], images: Record<string, string>): number[] {
  return [...new Set(frames.map((f) => f.second))].filter((s) => !images[String(s)]).sort((a, b) => a - b);
}

export type Fact = { label: string; value: string };
export type Moment = { label: string; second: number };

export type Craft = {
  // When each element first shows, in order.
  timing: Moment[];
  cta: Fact[];
  execution: Fact[];
  levers: string[];
  proof: string[];
  talent: Fact[];
};

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Yes' : 'No');
const AGE: Record<string, string> = { under_25: 'Under 25', '25_34': '25 to 34', '35_plus': '35 or older', mixed: 'Mixed ages' };

function facts(pairs: [string, string | null | undefined][]): Fact[] {
  return pairs.filter((p): p is [string, string] => typeof p[1] === 'string' && p[1].length > 0).map(([label, value]) => ({ label, value }));
}

// The taxonomy record as the "timing and craft" panel shows it. Unknown
// values are left out rather than shown as "Unknown".
export function craftOf(record: ClassificationRecord): Craft {
  const { reveal, cta, execution: ex, talent } = record;
  const timing: Moment[] = ([
    ['Product', reveal.product_s],
    ['Price', reveal.price_s],
    ['Offer', reveal.offer_s],
    ['App screen', reveal.app_ui_s],
    ['Logo', reveal.logo_s],
    ['Call to action', cta.first_s],
  ] as [string, number | null][])
    .filter((m): m is [string, number] => m[1] !== null)
    .map(([label, second]) => ({ label, second }))
    .sort((a, b) => a.second - b.second);
  const cuts = ex.cut_count === null ? null : `${ex.cut_count}${ex.cuts_per_10s !== null ? ` (${ex.cuts_per_10s} per 10 s)` : ''}`;
  return {
    timing,
    cta: facts([
      ['Channel', cta.channel && cta.channel !== 'none' ? labelText(cta.channel) : cta.channel === 'none' ? 'None' : null],
      ['Wording', cta.wording],
      ['Repeated', yesNo(cta.repeated)],
    ]),
    execution: facts([
      ['Cuts', cuts],
      ['Subtitles', yesNo(ex.subtitles)],
      ['Voiceover', yesNo(ex.voiceover)],
      ['Music only', yesNo(ex.music)],
      ['Existing sound', yesNo(ex.trend_sound)],
      ['Aspect ratio', ex.aspect_ratio],
    ]),
    levers: record.levers.filter((l) => l in COMMERCIAL_LEVER).map(labelText),
    proof: record.social_proof.filter((p) => p in SOCIAL_PROOF).map(labelText),
    talent: facts([
      ['On screen', talent.gender && talent.gender !== 'none' ? labelText(talent.gender) : talent.gender === 'none' ? 'Nobody' : null],
      ['Age', talent.age_bracket ? AGE[talent.age_bracket] : null],
      ['People', talent.people_count === null ? null : String(talent.people_count)],
      ['Face in first frame', yesNo(talent.face_first_frame)],
    ]),
  };
}

// 0:07, 1:12.
export function clock(s: number): string {
  const whole = Math.max(0, Math.floor(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
