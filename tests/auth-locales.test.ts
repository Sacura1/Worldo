import {describe, expect, it} from 'vitest';
import {LOCALES} from '../shared/languages';
import {authTranslations} from '../src/locales/auth';
import {messages, translate} from '../src/lib/i18n';
import {NEAR_AUTH_AWAITING_APPROVAL} from '../shared/near-auth';

const existingErrors = [
  'Sign-in expired. Please sign in again.',
  'Could not verify your NEAR sign-in. Please try again.',
  'NEAR Auth credentials are not configured.',
  'Try signing in again shortly.',
];
const permissionDetails =
  'Worldo can process up to {limit} game coins in trades for 30 days. You can revoke this in your account settings. Native NEAR and other apps are excluded.';
const onboarding = [
  'Create account & play',
  'Continue to play',
  'Worldo automatically handles your in-game trades.',
  'Creating your account…',
  'Preparing your world…',
  'Cancel setup',
  'Account & permissions',
  'Automatic in-game trades',
  'Manage play permission',
  'Permission details',
  permissionDetails,
  'Continue to play to finish account setup.',
  'Your account setup was cancelled. You can continue when you are ready.',
  'Account setup could not be confirmed. Continue to check its status before trying again.',
  'Connecting to your account…',
  'Setting up your account…',
  'Account setup is complete. You can close this window.',
  'Saving progress',
  'Progress saved',
  'Save delayed',
  'Local save',
  'Test world · items have no cash value',
  'Account setup is still being confirmed. Continue to play to check again.',
  'Your signed-in account changed. Please sign in again.',
  'Signed in. Finishing account setup…',
  'Setup stopped. Continue to check your account.',
  'Gameplay authorization is unavailable.',
  'Retry connection',
  'Sign-in is unavailable. Please try again.',
];
describe('localized sign-in and authorization feedback', () => {
  it.each(LOCALES)('%s covers every new popup message and the existing server errors', locale => {
    const source = Object.keys(authTranslations.en);
    expect(source).toHaveLength(44);
    expect(Object.keys(authTranslations[locale])).toEqual(source);
    expect(source).toEqual(expect.arrayContaining(onboarding));
    for (const key of [...source, ...existingErrors]) {
      expect(messages[locale][key], `${locale}: ${key}`).toBeTruthy();
      expect(translate(key, locale)).toBe(messages[locale][key]);
      if (locale !== 'en') expect(translate(key, locale), `${locale}: ${key}`).not.toBe(key);
    }
  });
  it.each(LOCALES)('%s preserves product names in the callback and provider feedback', locale => {
    expect(translate('Return to Worldo.', locale)).toContain('Worldo');
    expect(translate('NEAR sign-in is temporarily unavailable. Please try again.', locale)).toContain('NEAR');
    expect(translate('NEAR sign-in could not be completed. Please try again.', locale)).toContain('NEAR');
    expect(translate('Waiting for NEAR Auth approval', locale)).toContain('NEAR Auth');
    expect(translate(NEAR_AUTH_AWAITING_APPROVAL, locale)).toContain('NEAR Auth');
    expect(translate(NEAR_AUTH_AWAITING_APPROVAL, locale)).toContain('Worldo');
  });
  it.each(LOCALES)('%s preserves the permission limit and product names when rendering details', locale => {
    const rendered = translate(permissionDetails, locale, {limit: '25,000'});
    expect(rendered).toContain('25,000');
    expect(rendered).toContain('30');
    expect(rendered).toContain('Worldo');
    expect(rendered).toContain('NEAR');
    expect(rendered).not.toMatch(/\{\w+\}/);
    for (const [key, value] of Object.entries(authTranslations[locale])) {
      expect(value.match(/\{\w+\}/g) ?? [], `${locale}: ${key}`).toEqual(key.match(/\{\w+\}/g) ?? []);
    }
  });
});
