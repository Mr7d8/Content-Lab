import { describe, expect, it } from 'vitest';
import { checkMarket, normalizeText } from '../src/market';

const verdict = (text: string, extra: Omit<Parameters<typeof checkMarket>[0], 'texts'> = {}) => checkMarket({ texts: [text], ...extra });

// Ad texts from the Morocco e-commerce board's scan of 2026-10-02.
describe('checkMarket on a real Morocco scan', () => {
  it('finds the Moroccan ads', () => {
    expect(verdict('الديكور الزوين كيبدا بالتفاصيل! ضو LED بشكل ألعاب نارية يزيد الجمالية لبيتك. طلبو دابا').verdict).toBe('moroccan');
    expect(verdict('حيط عادي؟ زيدو لمسة مميزة بإضاءة LED على شكل ألعاب نارية! طلب ديالك دابا').verdict).toBe('moroccan');
    expect(verdict('INTENSE PULSED LASER  جهاز شد الوجه الجديد الثمن 175 درهم  التوصيل مجاني').verdict).toBe('moroccan');
    expect(verdict('عمر أجر الوضوء ما كينقطع. حط سطيلة فالجامع واضمن صدقة جارية ليك وللوالدين').verdict).toBe('moroccan');
    // A word Darija shares with other dialects is not enough alone.
    expect(verdict('هاد العرض').verdict).toBe('unclear');
  });

  it('sends Gulf, Asian and Russian ads elsewhere', () => {
    const chefz = verdict('مس مو بجدة ! اطلبوه الان من ذا شفز😍📲 @ذا شفز  وفوقها كاش باك 15 ريال اذا استخدمتو الكود');
    expect(chefz).toMatchObject({ verdict: 'elsewhere', elsewhere: 'Gulf' });
    expect(chefz.reasons.map((r) => r.label)).toContain('Gulf country or city');
    expect(verdict('بافلو وايلد وينجز وصل جدة في فيليج مول  @Buffalo Wild Wings KSA  احتفالًا بافتتاح فرعهم').elsewhere).toBe('Gulf');
    expect(verdict('الحقو عروض دخون باليوم الوطني خصم 50٪؜ على المنتج الاول والمنتج الثاني ب٩٦ ريال😍😍 #عروض_دخ').elsewhere).toBe('Gulf');
    expect(verdict('#عطور #عطورات_فاخرة #عطور_ريف #البحرين #تغطيات').elsewhere).toBe('Gulf');
    expect(verdict('🇸🇦 عروض اليوم الوطني في منكي لاند  طفلين بـ96 ريال للساعة،  والطفل بـ50 ريال فقط!').elsewhere).toBe('Gulf');
    expect(verdict('これは面白い！無駄に外国人に話しかけたくなる！ #トクトクSALE #tiktokshopで見つけた').elsewhere).toBe('East Asia');
    expect(verdict('Пока ты это читаешь, кто-то уже знакомится ;)').elsewhere).toBe('Russian-speaking market');
  });

  it('leaves short or neutral texts unclear', () => {
    for (const text of ['hi', '💃🏻', 'Discover relaxed resort dresses that feel as beautiful as they look.', 'Robe Vichy livraison gratuite', 'Pasta 🍝 @Counter  #mukbang #fitness #asmr']) {
      expect(verdict(text).verdict).toBe('unclear');
    }
  });
});

describe('checkMarket signals', () => {
  it('counts dirhams, places, phone numbers and .ma sites for Morocco', () => {
    expect(verdict('Robe Vichy 199 DH livraison gratuite').verdict).toBe('moroccan');
    expect(verdict('Livraison partout au Maroc').verdict).toBe('moroccan');
    expect(verdict('Showroom à Casablanca, appelez le +212 6 61 23 45 67').verdict).toBe('moroccan');
    expect(verdict('Commandez sur www.maboutique.ma').verdict).toBe('moroccan');
    expect(verdict('wakha, daba nsiftoh lik bzaf dyal l3orod').verdict).toBe('moroccan');
  });

  it('trusts the decoded language', () => {
    expect(verdict('hi', { language: 'darija' }).reasons).toEqual([{ label: 'Spoken in Darija', examples: [] }]);
    expect(verdict('hi', { spokenLanguage: 'Darija (Moroccan Arabic)' }).verdict).toBe('moroccan');
    expect(verdict('hi', { spokenLanguage: 'Egyptian Arabic' })).toMatchObject({ verdict: 'elsewhere', elsewhere: 'Egypt' });
  });

  it('weighs both sides: dirhams with Emirati signs are not Moroccan', () => {
    expect(verdict('عرض خاص 99 درهم في دبي').verdict).toBe('elsewhere');
    expect(verdict('التوصيل لجميع 58 ولاية الدفع عند الاستلام').elsewhere).toBe('Algeria');
    expect(verdict('Prix 29,99 €').elsewhere).toBe('Europe');
  });

  it('caps dialect words and lists the ones it found', () => {
    const r = verdict('دابا ديال بزاف زوين مزيان شحال');
    expect(r.verdict).toBe('moroccan');
    expect(r.reasons).toEqual([{ label: 'Darija words', examples: ['دابا', 'ديال', 'بزاف'] }]);
  });

  it('does not take words inside other words', () => {
    expect(verdict('صلاة هادئة').verdict).toBe('unclear');
    expect(verdict('Madrid and Dubaiyat').verdict).toBe('unclear');
  });

  it('normalizes Arabic letter variants', () => {
    expect(normalizeText('أإآ ة ى ـــ مَرْحَبًا')).toBe('ااا ه ي  مرحبا');
  });
});
