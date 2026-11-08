import {useState} from 'react';
import {ArrowRight, ChevronRight, Globe, LoaderCircle, RotateCcw, UserRound} from 'lucide-react';
import {CITIES, CITY_IDS} from '../../shared/config/cities';
import {GAMEPLAY_SPEND_LIMIT} from '../../shared/gameplay-permission';
import {NEAR_AUTH_AWAITING_APPROVAL} from '../../shared/near-auth';
import {LANGUAGES, useI18n, type Locale} from '../lib/i18n';
import {CITY_COLORS, CITY_ICONS} from './CityMap';
import {Modal} from './ui';
import './welcome.css';

export function PlayPermissionDetails() {
  const {t, formatNumber} = useI18n();
  return (
    <details className="play-permission-details">
      <summary>{t('Permission details')}</summary>
      <p>
        {t(
          'Worldo can process up to {limit} game coins in trades for 30 days. You can revoke this in your account settings. Native NEAR and other apps are excluded.',
          {limit: formatNumber(GAMEPLAY_SPEND_LIMIT)},
        )}
      </p>
    </details>
  );
}

export function WelcomeCard({
  localMode,
  authConfigured,
  guestPlay,
  configLoaded,
  connectionFailed,
  hasIdentity,
  authorized,
  busy,
  ready,
  onPlay,
  onGuest,
  onRetry,
  awaitingApproval = false,
  onDismissApproval = () => {},
}: {
  localMode: boolean;
  authConfigured: boolean;
  guestPlay: boolean;
  configLoaded: boolean;
  connectionFailed: boolean;
  hasIdentity: boolean;
  authorized: boolean;
  busy: boolean;
  ready: boolean;
  onPlay: () => void;
  onGuest: () => void;
  onRetry: () => void;
  awaitingApproval?: boolean;
  onDismissApproval?: () => void;
}) {
  const {t, locale, setLocale, formatNumber} = useI18n(),
    [showPermission, setShowPermission] = useState(false);
  const guestOnly = !localMode && guestPlay && !authConfigured && !hasIdentity,
    guestChoice = !localMode && guestPlay && authConfigured && !hasIdentity;
  const unavailable = configLoaded && !localMode && !authConfigured && !guestPlay,
    retry = connectionFailed || unavailable,
    loading = !retry && (!configLoaded || !ready);
  const label = retry
    ? 'Retry connection'
    : localMode || guestOnly
      ? 'Play as guest'
      : !hasIdentity
        ? 'Create account & play'
        : authorized
          ? 'Enter Worldo'
          : 'Continue to play';
  const showConsent = !localMode && !authorized && !guestOnly;
  return (
    <>
      <section className="welcome-card">
        <img className="welcome-logo" src="/brand/worldo-logo.png" alt="Worldo" />
        <div className="welcome-intro">
          <span className="eyebrow">{t('A world that needs you')}</span>
          <h1>
            {t('Three cities.')}
            <br />
            {t('One living economy.')}
          </h1>
          <p>
            {t(
              'Gather. Deliver. Keep the lights on. Your supplies put factories to work and help a harbor become a city.',
            )}
          </p>
          <div className="welcome-cities">
            {CITY_IDS.map(id => {
              const Icon = CITY_ICONS[id];
              return (
                <span key={id}>
                  <Icon color={CITY_COLORS[id]} size={20} />
                  {t(CITIES[id].name)}
                </span>
              );
            })}
          </div>
        </div>
        <div className="welcome-actions">
          {showConsent && (
            <p className="play-consent" id="play-consent">
              {t('Worldo automatically handles your in-game trades.')}
            </p>
          )}
          {unavailable && (
            <p className="inline-error" role="status">
              {t('Sign-in is unavailable. Please try again.')}
            </p>
          )}
          <button
            className="button primary enter-world"
            aria-describedby={showConsent ? 'play-consent' : undefined}
            aria-busy={busy || loading}
            disabled={busy || loading}
            onClick={retry ? onRetry : guestOnly ? onGuest : onPlay}
          >
            {busy || loading ? <LoaderCircle className="spin" /> : retry ? <RotateCcw /> : <ArrowRight />}
            {t(label)}
          </button>
          {guestChoice && (
            <button className="button guest-play" disabled={busy || loading} onClick={onGuest}>
              <UserRound size={17} />
              {t('Play as guest')}
            </button>
          )}
          {(guestOnly || guestChoice) && (
            <small className="guest-note">{t('No sign-up needed. Guest progress stays in this browser.')}</small>
          )}
          {showConsent && (
            <button className="permission-link" aria-haspopup="dialog" onClick={() => setShowPermission(true)}>
              {t('Permission details')}
              <ChevronRight size={12} />
            </button>
          )}
          {localMode && <small>{t('Local save')}</small>}
        </div>
        <div className="welcome-footer">
          <label>
            <Globe size={16} />
            <select aria-label={t('Language')} value={locale} onChange={e => setLocale(e.target.value as Locale)}>
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <a href="/?ff=1">
            {t('Watch the economy')}
            <ChevronRight size={14} />
          </a>
        </div>
      </section>
      {showPermission && (
        <Modal title="Permission details" onClose={() => setShowPermission(false)}>
          <p className="welcome-permission-copy">
            {t(
              'Worldo can process up to {limit} game coins in trades for 30 days. You can revoke this in your account settings. Native NEAR and other apps are excluded.',
              {limit: formatNumber(GAMEPLAY_SPEND_LIMIT)},
            )}
          </p>
        </Modal>
      )}
      {awaitingApproval && (
        <Modal title="Waiting for NEAR Auth approval" onClose={onDismissApproval}>
          <div className="welcome-awaiting">
            <p className="welcome-permission-copy">{t(NEAR_AUTH_AWAITING_APPROVAL)}</p>
            {guestPlay && (
              <>
                <p className="welcome-permission-copy">{t('You can play as a guest for now.')}</p>
                <button className="button primary" disabled={busy} onClick={onGuest}>
                  <UserRound size={17} />
                  {t('Play as guest')}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
