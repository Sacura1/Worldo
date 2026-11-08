import {afterEach, describe, expect, it, vi} from 'vitest';
import {LANGUAGES, LOCALES, isLocale, languageInfo, normalizeLocale, type Locale} from '../shared/languages';
import {appTranslations} from '../src/locales/app';
import {panelTranslations} from '../src/locales/panels';
import {npcTranslations} from '../src/locales/npc';
import {npcErrorTranslations} from '../src/locales/npc-errors';
import {runtimeTranslations} from '../src/locales/runtime';
import {formatNumber, getLocale, messages, setLocale, t, translate} from '../src/lib/i18n';

const expectedLocales = ['en', 'fr', 'es', 'pt', 'de', 'ar', 'hi', 'zh', 'ja', 'ko'];
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(values, key) ? String(values[key]) : match));
const catalogs = [
  {name: 'app', values: appTranslations, minimum: 250},
  {name: 'panels', values: panelTranslations, minimum: 100},
  {name: 'NPC dialogue', values: npcTranslations, minimum: 40},
  {name: 'NPC errors', values: npcErrorTranslations, minimum: 20},
  {name: 'runtime', values: runtimeTranslations, minimum: 200},
];

afterEach(() => {
  setLocale('en');
  vi.unstubAllGlobals();
});

describe('the ten supported languages', () => {
  it('registers each supported language once with a native label and valid direction', () => {
    expect(LOCALES).toEqual(expectedLocales);
    expect(LANGUAGES).toHaveLength(10);
    expect(new Set(LANGUAGES.map(language => language.code)).size).toBe(10);
    expect(new Set(LANGUAGES.map(language => language.tag)).size).toBe(10);
    for (const language of LANGUAGES) {
      expect(language.name.trim()).not.toBe('');
      expect(language.englishName.trim()).not.toBe('');
      expect(Intl.getCanonicalLocales(language.tag)).toHaveLength(1);
      expect(language.dir).toBe(language.code === 'ar' ? 'rtl' : 'ltr');
      expect(languageInfo(language.code)).toBe(language);
    }
  });

  it('normalizes browser regional language tags and rejects unsupported settings', () => {
    expect(normalizeLocale('fr-CA')).toBe('fr');
    expect(normalizeLocale('PT-BR')).toBe('pt');
    expect(normalizeLocale('zh-Hans-CN')).toBe('zh');
    expect(normalizeLocale('ar-EG')).toBe('ar');
    for (const unsupported of ['xx', '', null, undefined, 42, {}, '__proto__']) {
      expect(isLocale(unsupported)).toBe(false);
      expect(normalizeLocale(unsupported)).toBe('en');
    }
  });

  it('persists the preference and changes document direction when Arabic is selected', () => {
    const values = new Map<string, string>();
    const documentElement = {lang: 'en-US', dir: 'ltr'};
    vi.stubGlobal('document', {documentElement});
    vi.stubGlobal('localStorage', {setItem: (key: string, value: string) => values.set(key, value)});
    setLocale('ar');
    expect(getLocale()).toBe('ar');
    expect(documentElement).toEqual({lang: 'ar', dir: 'rtl'});
    expect(values.get('worldo.language')).toBe('ar');
    setLocale('fr');
    expect(documentElement).toEqual({lang: 'fr-FR', dir: 'ltr'});
    expect(values.get('worldo.language')).toBe('fr');
    setLocale('xx' as Locale);
    expect(getLocale()).toBe('fr');
  });

  it('switches text and display-number formatting without rewriting the input number', () => {
    const amount = 1234.56789;
    for (const code of LOCALES) {
      setLocale(code);
      expect(t('Worldo coins')).toBe(messages[code]['Worldo coins']);
      expect(formatNumber(amount, {maximumFractionDigits: 3})).toBe(
        new Intl.NumberFormat(languageInfo(code).tag, {maximumFractionDigits: 3}).format(amount),
      );
    }
    expect(amount).toBe(1234.56789);
  });
});

describe.each(catalogs)('$name catalog completeness', ({values, minimum}) => {
  it('contains a substantial English source catalog and all ten locale dictionaries', () => {
    expect(Object.keys(values).sort()).toEqual([...expectedLocales].sort());
    expect(Object.keys(values.en).length).toBeGreaterThanOrEqual(minimum);
  });

  it.each(LOCALES)('%s has every source key, nonempty text, and exactly the same interpolation fields', locale => {
    const sourceKeys = Object.keys(values.en).sort();
    expect(Object.keys(values[locale]).sort()).toEqual(sourceKeys);
    for (const key of sourceKeys) {
      const translated = values[locale][key];
      expect(typeof translated, `${locale}: ${key}`).toBe('string');
      expect(translated.trim(), `${locale}: ${key}`).not.toBe('');
      expect(placeholders(translated), `${locale}: ${key}`).toEqual(placeholders(values.en[key]));
    }
  });
});

describe('translation of game and transaction messages', () => {
  it.each(LOCALES)(
    '%s preserves exact station price strings when explicitly interpolating or matching server text',
    locale => {
      const key = '{price} coins / unit';
      const amount = '12345678901234567890';
      const expected = fill(messages[locale][key], {price: amount});
      expect(translate(key, locale, {price: amount})).toBe(expected);
      expect(translate(`${amount} coins / unit`, locale)).toBe(expected);
      expect(expected).toContain(amount);
      expect(expected).not.toContain('{price}');
      if (locale !== 'en') expect(expected).not.toBe(`${amount} coins / unit`);
    },
  );

  it.each(LOCALES)(
    '%s translates current city prices, nested resources and supply contracts without changing quantities',
    locale => {
      const priceKey = '{price} coins per unit; fuel {fuel}%, {resource} stock {stock}/{target}.';
      const expected = fill(messages[locale][priceKey], {
        price: 18,
        fuel: 22,
        resource: translate('wood', locale),
        stock: 40,
        target: 100,
      });
      expect(translate('18 coins per unit; fuel 22%, wood stock 40/100.', locale)).toBe(expected);
      const contractKey = '{quantity} units a day for {days} days';
      expect(translate('60 units a day for 3 days', locale)).toBe(
        fill(messages[locale][contractKey], {quantity: 60, days: 3}),
      );
      expect(translate('{name}’s opinion', locale, {name: 'Rosa'})).toBe(
        fill(messages[locale]['{name}’s opinion'], {name: 'Rosa'}),
      );
    },
  );

  it.each(LOCALES)('%s leaves addresses, transaction receipts, and atomic amounts intact', locale => {
    const identifiers = [
      'player-42.worldo.testnet',
      '0xA27bC4D53E96f5A70C5D4F6cBf96c5B12bD12AeF',
      '3MiYJDwAfY3pV1o8QQdkpN5VY1wJUBsB1LXH7voH1EGE',
      'a'.repeat(64),
      '999999999999999999999999999999999999',
      '0.000000000000000000000001',
      'station:harbor:1',
    ];
    const key = 'The game transaction failed. Receipt: {p0}';
    for (const identifier of identifiers) {
      expect(translate(identifier, locale)).toBe(identifier);
      expect(translate(key, locale, {p0: identifier})).toBe(fill(messages[locale][key], {p0: identifier}));
      expect(translate(`The game transaction failed. Receipt: ${identifier}`, locale)).toBe(
        fill(messages[locale][key], {p0: identifier}),
      );
    }
  });

  it('does not recursively translate explicitly supplied identifiers or treat replacement text as a pattern', () => {
    const key = 'The game transaction failed. Receipt: {p0}';
    for (const identifier of ['Cancel', '$&-$1-{amount}', 'Open secret.worldo.testnet']) {
      expect(translate(key, 'fr', {p0: identifier})).toBe(fill(messages.fr[key], {p0: identifier}));
    }
    expect(
      translate('Unknown route {account}: {amount}', 'ja', {account: 'player.worldo.testnet', amount: '0.00000001'}),
    ).toBe('Unknown route player.worldo.testnet: 0.00000001');
  });

  it('requires an entire runtime phrase match and preserves punctuation-sensitive unknown text', () => {
    const key = 'The game transaction failed. Receipt: {p0}';
    expect(translate('The game transaction failed! Receipt: abc', 'fr')).toBe(
      'The game transaction failed! Receipt: abc',
    );
    expect(translate(key, 'fr')).toBe(messages.fr[key]);
    expect(translate('', 'fr')).toBe('');
    expect(t(null)).toBe('');
  });
});
