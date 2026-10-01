import { z } from 'zod';

// Bump when any label set, description or Jev question changes, so new
// classifications never silently mix with old ones (classifications.prompt_version).
export const PROMPT_VERSION = 'taxonomy-v1';

type Described<K extends string> = Readonly<Record<K, string>>;
const keys = <K extends string>(d: Described<K>) => Object.keys(d) as [K, ...K[]];

// Each label carries a one-line description. Descriptions are the criteria
// Jev chooses between and the tooltips in the dashboard.

export const OBJECTIVE = {
  app_install: 'Drives app downloads: app store badges, app UI, "download" calls to action',
  purchase: 'Drives buying a product: products, prices, offers, "shop" or "order" calls to action',
  hybrid: 'Pushes both installing the app and buying specific products',
  brand: 'Builds awareness or image with no clear install or purchase ask',
} as const satisfies Described<string>;

export const HOOK_TYPE = {
  problem_statement: 'Opens by naming a problem or frustration the viewer has',
  price_shock: 'Opens on a surprisingly low price, a big discount or a price comparison',
  unboxing: 'Opens by unpacking or revealing a delivered product',
  pov: 'Opens with a POV framing or a first-person camera',
  reaction: 'Opens on someone reacting to a product, price or result',
  before_after: 'Opens by contrasting a before state with an after state',
  question: 'Opens by asking the viewer a question',
  bold_claim: 'Opens with a strong assertion or superlative claim',
  transformation: 'Opens mid-change: a look, space or result being transformed',
  trend_audio: 'The hook relies mainly on a recognizable trending sound or meme format',
  curiosity_gap: 'Opens by withholding a payoff, such as "wait for it"',
  testimonial_open: 'Opens with a customer or creator vouching for the product',
} as const satisfies Described<string>;

export const HOOK_CHANNEL = {
  visual_only: 'The first 3 seconds hook through visuals alone, no text or speech carries it',
  text_overlay: 'On-screen text carries the hook',
  spoken: 'Speech carries the hook',
  combined: 'Speech and on-screen text carry the hook together',
} as const satisfies Described<string>;

export const FORMAT = {
  creator_ugc: 'A creator filming themselves using or recommending the product, phone style',
  talking_head: 'One person speaking to camera for most of the ad',
  screen_recording: 'A recording of a phone or computer screen',
  app_walkthrough: 'Guided tour of the app showing how it works',
  product_demo: 'Hands-on demonstration of a product being used',
  catalogue_carousel: 'A sequence of products or listings shown one after another',
  haul: 'Someone showing many items they bought',
  skit: 'A scripted scene with characters or a short story',
  green_screen: 'A person in front of a background image or webpage',
  slideshow: 'Still images or slides with text, little or no motion',
  motion_graphics: 'Animated graphics and text, no filmed people',
} as const satisfies Described<string>;

export const STRUCTURE = {
  problem_solution: 'A problem is shown, then the product solves it',
  demo_benefit_cta: 'Demonstration, then benefits, then a call to action',
  listicle: 'A list of reasons, tips or items',
  story_arc: 'A small story with a beginning, a turn and an outcome',
  comparison: 'Compares the product or price with an alternative',
  offer_first: 'Leads with the offer or price, then shows what you get',
  social_proof_stack: 'Stacks reviews, ratings, orders or endorsements',
} as const satisfies Described<string>;

// Reveal timing: seconds to the first frame where each element is visible (vision pass).
export const REVEAL_ELEMENT = {
  app_ui: 'App screens or app interface',
  product: 'A physical product',
  price: 'A price',
  offer: 'A discount, promo code or special offer',
  logo: 'The brand or app logo',
} as const satisfies Described<string>;

export const COMMERCIAL_LEVER = {
  price_visible: 'A price is shown on screen',
  discount: 'A discount, sale or promo code is mentioned or shown',
  free_delivery: 'Free delivery or free shipping is mentioned or shown',
  urgency: 'Time pressure: today only, ends soon, countdown',
  scarcity: 'Limited stock or limited quantity',
  bundle: 'Several items sold together or buy-more-save-more',
  cash_on_delivery: 'Pay on delivery or cash on delivery is mentioned or shown',
  first_order_offer: 'A special offer for the first order or new users',
} as const satisfies Described<string>;

// An empty social_proof list means none.
export const SOCIAL_PROOF = {
  reviews_shown: 'Customer reviews or comments are shown',
  order_count: 'Number of orders, sales or users is shown',
  creator_endorsement: 'A creator or influencer personally endorses the product',
  ugc_montage: 'A montage of several customers using the product',
  ratings: 'Star ratings or scores are shown',
} as const satisfies Described<string>;

export const LANGUAGE = {
  darija: 'Moroccan Arabic (Darija)',
  french: 'French',
  arabic_msa: 'Modern Standard Arabic or other non-Moroccan Arabic',
  english: 'English',
  mixed: 'Two or more languages in significant amounts',
  none: 'No speech and no meaningful text',
} as const satisfies Described<string>;

export const CTA_CHANNEL = {
  spoken: 'The call to action is only spoken',
  text: 'The call to action is only on screen',
  both: 'The call to action is spoken and on screen',
  none: 'No explicit call to action',
} as const satisfies Described<string>;

export const GENDER = {
  female: 'The main on-screen person is a woman',
  male: 'The main on-screen person is a man',
  mixed: 'Several people of different genders share the screen',
  none: 'No person on screen',
} as const satisfies Described<string>;

export const AGE_BRACKET = {
  under_25: 'The main on-screen person looks under 25',
  '25_34': 'The main on-screen person looks 25 to 34',
  '35_plus': 'The main on-screen person looks 35 or older',
  mixed: 'Several people across age brackets',
  none: 'No person on screen',
} as const satisfies Described<string>;

export const ASPECT_RATIOS = ['9:16', '4:5', '1:1', '16:9', 'other'] as const;

export const Objective = z.enum(keys(OBJECTIVE));
export const HookType = z.enum(keys(HOOK_TYPE));
export const HookChannel = z.enum(keys(HOOK_CHANNEL));
export const Format = z.enum(keys(FORMAT));
export const Structure = z.enum(keys(STRUCTURE));
export const RevealElement = z.enum(keys(REVEAL_ELEMENT));
export const CommercialLever = z.enum(keys(COMMERCIAL_LEVER));
export const SocialProof = z.enum(keys(SOCIAL_PROOF));
export const Language = z.enum(keys(LANGUAGE));
export const CtaChannel = z.enum(keys(CTA_CHANNEL));
export const Gender = z.enum(keys(GENDER));
export const AgeBracket = z.enum(keys(AGE_BRACKET));
export const AspectRatio = z.enum(ASPECT_RATIOS);

const seconds = z.number().nonnegative().nullable();
const count = z.number().int().nonnegative().nullable();

// One classification record (classifications.labels_json). Unknown stays null.
export const ClassificationRecord = z.object({
  objective: Objective.nullable(),
  hook_type: HookType.nullable(),
  hook_channel: HookChannel.nullable(),
  format: Format.nullable(),
  structure: Structure.nullable(),
  reveal: z.object({
    app_ui_s: seconds,
    product_s: seconds,
    price_s: seconds,
    offer_s: seconds,
    logo_s: seconds,
  }),
  levers: z.array(CommercialLever),
  social_proof: z.array(SocialProof),
  execution: z.object({
    duration_s: seconds,
    cut_count: count,
    cuts_per_10s: z.number().nonnegative().nullable(),
    subtitles: z.boolean().nullable(),
    voiceover: z.boolean().nullable(),
    music: z.boolean().nullable(),
    trend_sound: z.boolean().nullable(),
    aspect_ratio: AspectRatio.nullable(),
  }),
  language: Language.nullable(),
  cta: z.object({
    channel: CtaChannel.nullable(),
    wording: z.string().min(1).nullable(),
    first_s: seconds,
    repeated: z.boolean().nullable(),
  }),
  talent: z.object({
    gender: Gender.nullable(),
    age_bracket: AgeBracket.nullable(),
    people_count: count,
    face_first_frame: z.boolean().nullable(),
  }),
});
export type ClassificationRecord = z.infer<typeof ClassificationRecord>;

// Where a label came from. Jev returns no text, so evidence is structured.
export const Origin = z.enum(['jev', 'vision', 'ffmpeg', 'audio', 'transcript', 'metadata']);
export type Origin = z.infer<typeof Origin>;

export const FieldEvidence = z.object({
  origin: Origin,
  confidence: z.number().min(0).max(1).nullable(),
  // Jev's probability per option, when the field came from Jev.
  probabilities: z.record(z.string(), z.number()).optional(),
  // Keyframe seconds the field was judged on.
  frames: z.array(z.number().nonnegative()).optional(),
  // Transcript passages the field was judged on.
  segments: z.array(z.object({ start: z.number().nullable(), end: z.number().nullable(), text: z.string() })).optional(),
  // Optional written note; whether labels need one is still an open decision.
  note: z.string().optional(),
});
export type FieldEvidence = z.infer<typeof FieldEvidence>;

// Keyed by field path, e.g. "hook_type", "reveal.price_s", "levers.discount".
export const Evidence = z.record(z.string(), FieldEvidence);
export type Evidence = z.infer<typeof Evidence>;

// Single-choice dimensions the dashboard can filter on, with their options.
export const FILTER_DIMENSIONS = {
  objective: { title: 'Objective', options: OBJECTIVE },
  hook_type: { title: 'Hook type', options: HOOK_TYPE },
  hook_channel: { title: 'Hook channel', options: HOOK_CHANNEL },
  format: { title: 'Format', options: FORMAT },
  structure: { title: 'Structure', options: STRUCTURE },
  language: { title: 'Language', options: LANGUAGE },
} as const;
export type FilterDimension = keyof typeof FILTER_DIMENSIONS;

// List dimensions: filtering means "contains this value".
export const LIST_DIMENSIONS = {
  levers: { title: 'Commercial levers', options: COMMERCIAL_LEVER },
  social_proof: { title: 'Social proof', options: SOCIAL_PROOF },
} as const;
export type ListDimension = keyof typeof LIST_DIMENSIONS;

export function labelText(value: string | null | undefined): string {
  if (value === null || value === undefined) return 'Unknown';
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Lowest confidence across fields, so one weak label is never hidden by an average.
export function lowestConfidence(evidence: Evidence): number | null {
  const values = Object.values(evidence)
    .map((e) => e.confidence)
    .filter((c): c is number => c !== null);
  return values.length ? Math.min(...values) : null;
}
