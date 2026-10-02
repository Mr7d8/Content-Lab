import { describe, expect, it } from 'vitest';
import { advertiserKeys, hostOf, landingSignals } from '../src/landing';
import { checkMarket } from '../src/market';

const shopifyMa = `<!doctype html><html lang="ar-MA"><head>
<title>الجاذبية الحقيقية للرجال &amp; عطور</title>
<meta name="description" content="عطر رجالي، التوصيل مجاني لجميع المدن">
<meta property="og:price:currency" content="MAD">
<script>Shopify.theme = {"name":"Dawn"}; var x = "ignore me in text";</script>
<link href="https://cdn.shopify.com/s/files/theme.css" rel="stylesheet">
</head><body><style>.a{color:red}</style>
<h1>4 عطور ب 299 درهم</h1><p>الدفع عند الاستلام</p>
<a href="https://wa.me/212612345678?text=salam">WhatsApp</a>
<select name="city"><option>الدار البيضاء</option><option>الرباط</option></select>
</body></html>`;

const youcanSa = `<html lang="ar"><head><meta content="ar_SA" property="og:locale"><title>متجر</title></head>
<body><script>window.store = {"currency":"SAR"}</script><img src="https://cdn.youcan.shop/x.png">
<p>السعر 149 ريال</p><a href="tel:+966501234567">اتصل</a></body></html>`;

describe('landingSignals', () => {
  it('reads currency, locale, WhatsApp links, platform and text from a Moroccan Shopify store', () => {
    const s = landingSignals(shopifyMa, 'https://www.sooknow.com/pages/parfum?utm_source=tiktok');
    expect(s).toMatchObject({ host: 'sooknow.com', currency: 'MAD', locale: 'ar_MA', platform: 'shopify', links: ['https://wa.me/212612345678?text=salam'] });
    expect(s.text).toContain('الجاذبية الحقيقية للرجال & عطور');
    expect(s.text).toContain('4 عطور ب 299 درهم');
    expect(s.text).not.toContain('ignore me');
    expect(s.text).not.toContain('color:red');
  });

  it('reads a Saudi YouCan store', () => {
    expect(landingSignals(youcanSa, 'https://boutique.youcan.shop/')).toMatchObject({ currency: 'SAR', locale: 'ar_SA', platform: 'youcan', links: ['tel:+966501234567'] });
  });

  it('copes with pages that have none of it', () => {
    expect(landingSignals('<p>hello</p>', 'not a url')).toMatchObject({ host: '', currency: null, locale: null, links: [], platform: null, text: 'hello' });
  });
});

describe('checkMarket with a landing page, a cover read and the advertisers list', () => {
  const plain = { texts: ['Lure Him: 4 perfumes'] };

  it('turns an unclear ad Moroccan from its store', () => {
    expect(checkMarket(plain).verdict).toBe('unclear');
    const r = checkMarket({ ...plain, landing: landingSignals(shopifyMa, 'https://sooknow.com/pages/parfum') });
    expect(r.verdict).toBe('moroccan');
    expect(r.reasons.map((x) => x.label)).toEqual(expect.arrayContaining(['Store prices in dirhams (MAD)', 'Moroccan phone number', 'Store set to Morocco', 'Price in dirhams', 'Moroccan city']));
  });

  it('sends a Gulf store elsewhere even with no Gulf words in the ad', () => {
    expect(checkMarket({ ...plain, landing: landingSignals(youcanSa, 'https://boutique.youcan.shop/') })).toMatchObject({ verdict: 'elsewhere', elsewhere: 'Gulf' });
  });

  it('uses the cover read: its text and the country it points to', () => {
    expect(checkMarket({ texts: ['hi'], cover: { text: ['199 DH', 'livraison gratuite'], country: 'MA' } })).toMatchObject({ verdict: 'moroccan' });
    expect(checkMarket({ texts: ['hi'], cover: { text: [], country: 'SA' } })).toMatchObject({ verdict: 'elsewhere', elsewhere: 'Gulf' });
    expect(checkMarket({ texts: ['hi'], cover: { text: [], country: null } }).verdict).toBe('unclear');
  });

  it('lets the advertisers list decide, with the name shown', () => {
    const known = checkMarket({ texts: ['hi'], advertiser: { status: 'moroccan', name: 'Modines.ma' } });
    expect(known.verdict).toBe('moroccan');
    expect(known.reasons[0]).toEqual({ label: 'Known Moroccan advertiser', examples: ['Modines.ma'] });
    expect(checkMarket({ texts: ['طلبو دابا 199 درهم'], advertiser: { status: 'blocked', name: 'X' } })).toMatchObject({ verdict: 'elsewhere', elsewhere: 'Blocked by the team' });
  });

  it('counts Moroccan and Algerian couriers', () => {
    expect(checkMarket({ texts: ['Livraison avec Ozon Express partout'] }).reasons.map((r) => r.label)).toContain('Moroccan delivery company');
    expect(checkMarket({ texts: ['التوصيل مع Yalidine'] })).toMatchObject({ verdict: 'elsewhere', elsewhere: 'Algeria' });
  });
});

describe('advertiserKeys', () => {
  it('keys by brand and landing host, without placeholders or shared hosts', () => {
    expect(advertiserKeys({ brand: ' Modines  Store ', landingHost: 'www.Modines.ma' })).toEqual(['brand:modines store', 'domain:modines.ma']);
    expect(advertiserKeys({ brand: 'Not Mention', landingHost: 'sooknow.com' })).toEqual(['domain:sooknow.com']);
    expect(advertiserKeys({ brand: null, landingHost: 'vt.tiktok.com' })).toEqual([]);
    expect(advertiserKeys({ brand: 'x', landingHost: 'mystore.youcan.shop' })).toEqual(['domain:mystore.youcan.shop']);
    expect(hostOf('https://WWW.Example.ma/a')).toBe('example.ma');
  });
});
