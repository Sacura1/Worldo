import {describe, expect, it} from 'vitest';
import {messages} from '../src/lib/i18n';
import {LANGUAGES, type Locale} from '../shared/languages';

describe('game translation semantics', () => {
  it('describes contract deposits as collateral and distinguishes them from incoming wallet payments', () => {
    const collateral: Record<Exclude<Locale, 'en'>, RegExp> = {
      fr: /caution/i,
      es: /depósito/i,
      pt: /caução/i,
      de: /Sicherheit/i,
      ar: /ضمان/,
      hi: /जमानत/,
      zh: /保证金/,
      ja: /保証金/,
      ko: /보증금/,
    };
    for (const [locale, term] of Object.entries(collateral) as [Exclude<Locale, 'en'>, RegExp][]) {
      expect(messages[locale]['Deposit at acceptance'], locale).toMatch(term);
      expect(messages[locale]['Contract completed. Deposit returned.'], locale).toMatch(term);
    }
    const paymentTerms: Partial<Record<Locale, RegExp>> = {
      ar: /إيداع|الإيداع/,
      hi: /जमा/,
      zh: /充值|存款/,
      ja: /入金/,
      ko: /입금/,
    };
    for (const [locale, payment] of Object.entries(paymentTerms) as [Locale, RegExp][])
      expect(messages[locale]['Deposit detected'], locale).toMatch(payment);
  });
  it('explains inventory-based pricing rather than stock-market prices', () => {
    const inventoryTerms: Record<Exclude<Locale, 'en'>, RegExp> = {
      fr: /stocks?/i,
      es: /existencias/i,
      pt: /estoque/i,
      de: /Bestand/i,
      ar: /مخزون/,
      hi: /भंडार/,
      zh: /库存/,
      ja: /在庫/,
      ko: /재고/,
    };
    for (const [locale, inventory] of Object.entries(inventoryTerms) as [Exclude<Locale, 'en'>, RegExp][])
      expect(
        messages[locale]['{price} coins per unit; fuel {fuel}%, {resource} stock {stock}/{target}.'],
        locale,
      ).toMatch(inventory);
  });
  it('translates the interface wording around Worldo branding in every language', () => {
    const headings = ['Worldo coins', 'Worldo guide', 'Open Worldo to start your local game.'];
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
    for (const {code} of LANGUAGES) {
      if (code === 'en') continue;
      for (const key of headings) {
        const copy = messages[code][key];
        expect(copy, code + ': ' + key).toBeTruthy();
        expect(copy, code + ': ' + key).toContain('Worldo');
        expect(normalize(copy), code + ': ' + key).not.toBe(normalize(key));
      }
    }
  });
});
