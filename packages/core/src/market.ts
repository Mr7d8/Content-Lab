// "Looks Moroccan": whether an ad seems made for Moroccan shoppers, from its
// text. Creative Center's Morocco results mix Moroccan ads with Gulf,
// Egyptian and Asian ads that also ran in Morocco; a board filters on this.
// Rules only, no AI: prices in dirhams, Darija words, Moroccan places, phone
// numbers and sites count for Morocco; other currencies, places, dialects,
// Eastern Arabic digits and other scripts count against.

export type MarketVerdict = 'moroccan' | 'elsewhere' | 'unclear';

// One reason, with the words that triggered it for dialect reasons.
export type MarketReason = { label: string; examples: string[] };

export type MarketCheck = {
  verdict: MarketVerdict;
  // Where it looks made for when not Morocco: "Gulf", "Egypt", "East Asia"...
  elsewhere: string | null;
  // Short reasons, strongest first, for the inspector.
  reasons: MarketReason[];
};

export type MarketInput = {
  // Ad text, advertiser name, and after a decode the on-screen text, speech,
  // offer and call to action.
  texts: (string | null | undefined)[];
  // Taxonomy language label from a decode (darija, french, arabic_msa...).
  language?: string | null;
  // The decode's free-text spoken language, e.g. "Darija (Moroccan Arabic)".
  spokenLanguage?: string | null;
  landingUrl?: string | null;
};

const LETTER = '[\\p{L}\\p{M}\\p{N}_]';

// Lowercase, without Arabic diacritics or tatweel, and with the letter
// variants Moroccan and Gulf writers mix (alef forms, ta marbuta, alef maqsura).
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

// Whole words (Arabic or Latin), allowing Arabic's attached prefixes
// (wa-, fa-, bi-, li-, al-) in front.
function words(list: string[], arabicPrefixes = true): RegExp {
  const body = list.map((w) => normalizeText(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const prefix = arabicPrefixes ? '(?:[وفبل]?(?:ال)?)?' : '';
  return new RegExp(`(?<!${LETTER})${prefix}(?:${body})(?!${LETTER})`, 'gu');
}

type Rule = { side: string; weight: number; reason: string; pattern: RegExp; perMatch?: boolean };

const MA = 'Morocco';

// Words only Moroccan Darija uses, and common ones it shares with Algerian,
// Tunisian or Levantine Arabic (worth less).
const DARIJA_STRONG = [
  'دابا', 'ديال', 'ديالك', 'ديالي', 'ديالو', 'ديالها', 'ديالنا', 'ديالكم', 'ديالهم', 'بزاف', 'زوين', 'زوينه', 'زوينين', 'مزيان', 'مزيانه',
  'شحال', 'فابور', 'بغيتي', 'بغيتو', 'كنبغي', 'كتبغي', 'والو', 'ديما', 'عافاك', 'دغيا', 'بلاصه', 'كيفاش', 'نتوما',
  // Present tense with the Darija ka- prefix, as ads use it.
  'كيبدا', 'كينقطع', 'كيخليك', 'كيخلي', 'كيعطيك', 'كيعطي', 'كيدير', 'كتدير', 'كنديرو', 'كيجي', 'كيبان', 'كيبقي', 'كيولي', 'كتولي',
  'كيحمي', 'كيصلح', 'كيخدم', 'كتخدم', 'كنصحك', 'كنصحكم', 'كنقدمو', 'كنوفرو', 'كيوصل', 'كيوصلك', 'كتوصل', 'كتوصلك', 'كتلقا', 'كتلقاو',
  'كيدوز', 'كيعجبك', 'كتعجبك', 'كتقلب', 'كتقلبي', 'كيتسنى', 'كنتسناوك', 'كيبغي', 'كيحتاج', 'كتحتاج',
];
const DARIJA_COMMON = ['واش', 'هاد', 'هادي', 'هادا', 'هادو', 'حيت', 'باش', 'علاش', 'كاين', 'كاينه', 'كاينين', 'خويا'];
const DARIJA_LATIN = ['daba', 'dyal', 'dyali', 'dyalek', 'bzaf', 'bezzaf', 'zwin', 'zwina', 'mzyan', 'mezyan', 'chhal', 'ch7al', 'bghiti', 'wakha', '3afak', 'khouya', 'kifach'];
const MA_CITIES = [
  'الدار البيضاء', 'كازا', 'كازابلانكا', 'الرباط', 'مراكش', 'فاس', 'طنجه', 'اكادير', 'مكناس', 'القنيطره', 'تطوان', 'الناظور', 'بني ملال', 'تماره', 'الصويره', 'خريبكه',
];
const MA_CITIES_LATIN = [
  'casablanca', 'rabat', 'marrakech', 'marrakesh', 'fes', 'fès', 'tanger', 'tangier', 'agadir', 'meknes', 'meknès', 'oujda', 'kenitra', 'kénitra',
  'tetouan', 'tétouan', 'nador', 'el jadida', 'mohammedia', 'temara', 'témara', 'essaouira', 'beni mellal', 'safi', 'laayoune', 'dakhla',
];

const RULES: Rule[] = [
  // Morocco
  { side: MA, weight: 3, reason: 'Mentions Morocco', pattern: /(?:🇲🇦|(?<![\p{L}])(?:maroc|marocaine?s?|morocco|moroccan|maghrib)(?![\p{L}]))/gu },
  { side: MA, weight: 3, reason: 'Mentions Morocco', pattern: words(['المغرب', 'مغربي', 'مغربيه', 'المغربي', 'المغربيه', 'مغاربه']) },
  { side: MA, weight: 2, reason: 'Price in dirhams', pattern: words(['درهم', 'دراهم']) },
  { side: MA, weight: 2, reason: 'Price in dirhams', pattern: /(?:\d\s?(?:dh|mad)(?![\p{L}])|(?<![\p{L}])dirhams?(?![\p{L}]))/gu },
  { side: MA, weight: 2, reason: 'Darija words', pattern: words(DARIJA_STRONG), perMatch: true },
  { side: MA, weight: 1, reason: 'Darija words', pattern: words(DARIJA_COMMON), perMatch: true },
  { side: MA, weight: 1, reason: 'Darija words', pattern: words(DARIJA_LATIN, false), perMatch: true },
  { side: MA, weight: 2, reason: 'Moroccan city', pattern: words(MA_CITIES) },
  { side: MA, weight: 2, reason: 'Moroccan city', pattern: words(MA_CITIES_LATIN, false) },
  { side: MA, weight: 3, reason: 'Moroccan phone number', pattern: /(?:\+|00)212[\s.-]?[5-7]/g },
  { side: MA, weight: 3, reason: 'Moroccan website (.ma)', pattern: /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}-]+\.)+ma(?=$|[/\s?#:),!])/gu },

  // Gulf
  { side: 'Gulf', weight: 3, reason: 'Gulf country or city', pattern: /🇸🇦|🇦🇪|🇰🇼|🇶🇦|🇧🇭|🇴🇲/gu },
  {
    side: 'Gulf', weight: 3, reason: 'Gulf country or city',
    pattern: words(['السعوديه', 'سعودي', 'سعوديه', 'الرياض', 'جده', 'مكه', 'الدمام', 'دبي', 'ابوظبي', 'الشارقه', 'الامارات', 'اماراتي', 'الكويت', 'كويتي', 'قطري', 'الدوحه', 'البحرين', 'المنامه', 'عمان', 'مسقط']),
  },
  { side: 'Gulf', weight: 3, reason: 'Gulf country or city', pattern: /(?<![\p{L}])(?:saudi|ksa|riyadh|jeddah|dubai|abu dhabi|sharjah|uae|kuwait|qatar|doha|bahrain|muscat)(?![\p{L}])/gu },
  { side: 'Gulf', weight: 2, reason: 'Price in riyals or another Gulf currency', pattern: words(['ريال', 'ر.س', 'د.ا', 'د.ك', 'ر.ق', 'د.ب', 'ر.ع']) },
  { side: 'Gulf', weight: 3, reason: 'Price in riyals or another Gulf currency', pattern: /(?<![\p{L}])(?:sar|aed|kwd|qar|bhd|omr)(?![\p{L}])/gu },
  { side: 'Gulf', weight: 2, reason: 'National Day offer', pattern: /اليوم الوطني/gu },
  { side: 'Gulf', weight: 1, reason: 'Gulf dialect', pattern: words(['الحين', 'دحين', 'وش', 'ابغي', 'ابغا', 'شلون', 'يبغي', 'تبغي']), perMatch: true },

  // Egypt, Algeria, Tunisia
  { side: 'Egypt', weight: 3, reason: 'Egypt', pattern: /🇪🇬|(?<![\p{L}])(?:egypt|cairo|egp)(?![\p{L}])/gu },
  { side: 'Egypt', weight: 3, reason: 'Egypt', pattern: words(['مصر', 'مصري', 'مصريه', 'القاهره', 'الاسكندريه', 'جنيه', 'ج.م']) },
  { side: 'Egypt', weight: 1, reason: 'Egyptian dialect', pattern: words(['عايز', 'عاوز', 'ازاي', 'دلوقتي', 'كده', 'عشان']), perMatch: true },
  { side: 'Algeria', weight: 3, reason: 'Algeria', pattern: /🇩🇿|(?<![\p{L}])(?:algérie|algerie|algeria|dzd)(?![\p{L}])|\d\s?da(?![\p{L}])/gu },
  { side: 'Algeria', weight: 3, reason: 'Algeria', pattern: words(['الجزائر', 'جزائري', 'جزائريه', 'دزاير', 'دج']) },
  { side: 'Algeria', weight: 3, reason: 'Delivery to all 58 or 69 wilayas', pattern: /(?:58|69)\s?ولايه/gu },
  { side: 'Tunisia', weight: 3, reason: 'Tunisia', pattern: /🇹🇳|(?<![\p{L}])(?:tunisie|tunisia|tnd)(?![\p{L}])/gu },
  { side: 'Tunisia', weight: 3, reason: 'Tunisia', pattern: words(['تونس', 'تونسي', 'تونسيه', 'برشا', 'د.ت']) },

  // Not Moroccan shoppers' writing
  { side: 'Middle East', weight: 2, reason: 'Eastern Arabic digits (not used in Morocco)', pattern: /[٠-٩]/g },
  { side: 'Europe', weight: 2, reason: 'Price in euros', pattern: /€|(?<![\p{L}])eur(?:os?)?(?![\p{L}])/gu },
  { side: 'East Asia', weight: 4, reason: 'Japanese, Chinese or Korean text', pattern: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Hangul}]/gu },
  { side: 'Russian-speaking market', weight: 4, reason: 'Cyrillic text', pattern: /\p{Script=Cyrillic}/gu },
  { side: 'South or Southeast Asia', weight: 4, reason: 'Thai, Hindi or Vietnamese text', pattern: /[\p{Script=Thai}\p{Script=Devanagari}]|[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹơưđ]/gu },
];

const MAX_WORD_POINTS = 3;

function spokenSignals(input: MarketInput): { side: string; weight: number; reason: string }[] {
  const out: { side: string; weight: number; reason: string }[] = [];
  const spoken = input.spokenLanguage ?? '';
  if (input.language === 'darija' || /darija|moroccan/i.test(spoken)) out.push({ side: MA, weight: 3, reason: 'Spoken in Darija' });
  else if (/egyptian/i.test(spoken)) out.push({ side: 'Egypt', weight: 3, reason: 'Spoken in Egyptian Arabic' });
  else if (/gulf|saudi|emirati|khaleeji|kuwaiti/i.test(spoken)) out.push({ side: 'Gulf', weight: 3, reason: 'Spoken in Gulf Arabic' });
  else if (/algerian/i.test(spoken)) out.push({ side: 'Algeria', weight: 3, reason: 'Spoken in Algerian Arabic' });
  else if (/tunisian/i.test(spoken)) out.push({ side: 'Tunisia', weight: 3, reason: 'Spoken in Tunisian Arabic' });
  return out;
}

export function checkMarket(input: MarketInput): MarketCheck {
  const text = normalizeText([...input.texts, input.landingUrl].filter((t): t is string => !!t && !!t.trim()).join('\n'));
  const scores = new Map<string, number>();
  const reasons = new Map<string, { side: string; weight: number; found: Set<string> }>();
  const add = (side: string, weight: number, reason: string, found?: string) => {
    scores.set(side, (scores.get(side) ?? 0) + weight);
    const r = reasons.get(reason) ?? { side, weight: 0, found: new Set<string>() };
    r.weight += weight;
    if (found) r.found.add(found);
    reasons.set(reason, r);
  };

  for (const s of spokenSignals(input)) add(s.side, s.weight, s.reason);
  // Each reason counts once, except dialect words, which add up to a cap.
  const wordPoints = new Map<string, number>();
  for (const rule of RULES) {
    const matches = [...text.matchAll(rule.pattern)].map((m) => m[0].trim());
    if (!matches.length) continue;
    if (rule.perMatch) {
      const distinct = [...new Set(matches)];
      const used = wordPoints.get(rule.side) ?? 0;
      const points = Math.min(distinct.length * rule.weight, MAX_WORD_POINTS - used);
      if (points <= 0) continue;
      wordPoints.set(rule.side, used + points);
      add(rule.side, points, rule.reason);
      for (const d of distinct.slice(0, 3)) reasons.get(rule.reason)?.found.add(d);
    } else if (!reasons.has(rule.reason)) {
      add(rule.side, rule.weight, rule.reason, matches[0]);
    }
  }

  const morocco = scores.get(MA) ?? 0;
  const others = [...scores.entries()].filter(([side]) => side !== MA).sort((a, b) => b[1] - a[1]);
  const against = others.reduce((sum, [, v]) => sum + v, 0);
  const verdict: MarketVerdict = morocco >= 2 && morocco > against ? 'moroccan' : against >= 2 && against >= morocco ? 'elsewhere' : 'unclear';
  const listed = [...reasons.entries()]
    .filter(([, r]) => (verdict === 'moroccan' ? r.side === MA : verdict === 'elsewhere' ? r.side !== MA : true))
    .sort((a, b) => b[1].weight - a[1].weight)
    .map(([label, r]) => ({ label, examples: /words|dialect/.test(label) ? [...r.found] : [] }));
  return { verdict, elsewhere: verdict === 'elsewhere' ? (others[0]?.[0] ?? null) : null, reasons: listed };
}
