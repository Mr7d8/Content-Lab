// Starter boards for the Moroccan market: the words Moroccan sellers write,
// the competitors, and the advertisers the checks have found. Picking one in
// the New board dialog fills the form; every field stays editable.

export type BoardPreset = {
  id: string;
  label: string;
  description: string;
  source: 'tiktok_creative_center' | 'tiktok_organic' | 'meta_ad_library';
  type: 'keyword' | 'advertiser' | 'hashtag' | 'snowball';
  // Comma-separated terms (see terms.ts); "auto" for snowball boards.
  value: string;
  region: string;
  objective: 'purchase' | 'app_install' | null;
  moroccanOnly: boolean;
  name: string;
};

export const MOROCCO_PRESETS: readonly BoardPreset[] = [
  {
    id: 'meta-ecom',
    label: 'Moroccan e-commerce on Meta',
    description: 'Video ads running in Morocco on Facebook and Instagram, found by the words Moroccan COD stores write and by YouCan store links.',
    source: 'meta_ad_library',
    type: 'keyword',
    value: 'youcan.shop, livraison gratuite, paiement à la livraison, الدفع عند الاستلام, التوصيل مجاني, التوصيل فابور, اطلبي دابا, درهم',
    region: 'MA',
    objective: null,
    moroccanOnly: true,
    name: 'Moroccan e-commerce on Meta',
  },
  {
    id: 'meta-competitors',
    label: 'Wasal competitors on Meta',
    description: 'The video ads the marketplaces and seller platforms run in Morocco, from their own Facebook pages. Edit the names to fit.',
    source: 'meta_ad_library',
    type: 'advertiser',
    value: 'Jumia, Avito.ma, Marjane Market, Electroplanet, KITEA, YouCan',
    region: 'MA',
    objective: null,
    moroccanOnly: false,
    name: 'Wasal competitors on Meta',
  },
  {
    id: 'seller-words',
    label: 'Moroccan seller words',
    description: 'Top ads using the words Moroccan e-commerce ads are written in: cash on delivery, free delivery, dirhams, Maroc.',
    source: 'tiktok_creative_center',
    type: 'keyword',
    value: 'maroc, livraison gratuite, paiement à la livraison, الدفع عند الاستلام, التوصيل مجاني, التوصيل فابور, اطلب الآن, اطلبي دابا, درهم, المغرب',
    region: 'MA',
    objective: 'purchase',
    moroccanOnly: true,
    name: 'Moroccan seller words',
  },
  {
    id: 'competitors',
    label: 'Competitors in Morocco',
    description: 'Top ads from the marketplaces and retailers competing for Moroccan shoppers. Edit the names to fit.',
    source: 'tiktok_creative_center',
    type: 'advertiser',
    value: 'Jumia, Temu, Shein, AliExpress, Avito, Marjane, Electroplanet, Kitea, Glovo, Hmall',
    region: 'MA',
    objective: null,
    moroccanOnly: false,
    name: 'Competitors in Morocco',
  },
  {
    id: 'followed',
    label: 'Moroccan advertisers found',
    description: 'Follows every advertiser the checks found to be Moroccan, and the ones you marked Moroccan. Grows as you scan.',
    source: 'tiktok_creative_center',
    type: 'snowball',
    value: 'auto',
    region: 'MA',
    objective: null,
    moroccanOnly: true,
    name: 'Moroccan advertisers found',
  },
  {
    id: 'organic-words',
    label: 'Moroccan TikTok posts',
    description: 'Organic and boosted posts found by searching from Morocco, in the words Moroccan buyers and sellers use.',
    source: 'tiktok_organic',
    type: 'keyword',
    value: 'livraison gratuite maroc, التوصيل مجاني المغرب, الدفع عند الاستلام, unboxing maroc, شريت من, عروض المغرب',
    region: 'MA',
    objective: null,
    moroccanOnly: true,
    name: 'Moroccan TikTok posts',
  },
  {
    id: 'organic-hashtags',
    label: 'Moroccan hashtags',
    description: 'Posts under the hashtags Moroccan shoppers follow.',
    source: 'tiktok_organic',
    type: 'hashtag',
    value: 'tiktokmaroc, maroc, المغرب, casablanca, marocaine',
    region: 'MA',
    objective: null,
    moroccanOnly: true,
    name: 'Moroccan hashtags',
  },
];
