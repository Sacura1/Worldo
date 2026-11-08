export const LANGUAGES = [
  {code: 'en', name: 'English', englishName: 'English', tag: 'en-US', dir: 'ltr'},
  {code: 'fr', name: 'Français', englishName: 'French', tag: 'fr-FR', dir: 'ltr'},
  {code: 'es', name: 'Español', englishName: 'Spanish', tag: 'es-ES', dir: 'ltr'},
  {code: 'pt', name: 'Português', englishName: 'Portuguese', tag: 'pt-BR', dir: 'ltr'},
  {code: 'de', name: 'Deutsch', englishName: 'German', tag: 'de-DE', dir: 'ltr'},
  {code: 'ar', name: 'العربية', englishName: 'Arabic', tag: 'ar', dir: 'rtl'},
  {code: 'hi', name: 'हिन्दी', englishName: 'Hindi', tag: 'hi-IN', dir: 'ltr'},
  {code: 'zh', name: '简体中文', englishName: 'Mandarin Chinese', tag: 'zh-CN', dir: 'ltr'},
  {code: 'ja', name: '日本語', englishName: 'Japanese', tag: 'ja-JP', dir: 'ltr'},
  {code: 'ko', name: '한국어', englishName: 'Korean', tag: 'ko-KR', dir: 'ltr'},
] as const;
export type Locale = (typeof LANGUAGES)[number]['code'];
export const LOCALES = LANGUAGES.map(language => language.code) as [Locale, ...Locale[]];
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LANGUAGES.some(language => language.code === value);
}
export function normalizeLocale(value: unknown): Locale {
  if (isLocale(value)) return value;
  const base = typeof value === 'string' ? value.toLowerCase().split('-')[0] : '';
  return isLocale(base) ? base : 'en';
}
export const languageInfo = (locale: Locale) => LANGUAGES.find(language => language.code === locale)!;
