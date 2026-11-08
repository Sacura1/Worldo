import type {GameSnapshot} from '../../shared/game';
import {cityRequest, getCitySession} from './city-api';
import {getNearIdentity, getGameplaySession, type GameplaySession, type NearIdentity} from './near-auth';

export type AppConfig = {
  network: 'testnet' | 'mainnet';
  authConfigured: boolean;
  guestPlay: boolean;
  chainSyncEnabled: boolean;
  localMode: boolean;
  appOrigin: string;
  contractId: string | null;
};
type SavedGame = Awaited<ReturnType<typeof getCitySession>>;
type WelcomeCallbacks = {
  isCurrent: () => boolean;
  onConfig: (config: AppConfig) => void;
  onOverview: (snapshot: GameSnapshot) => void;
  onIdentity: (identity: NearIdentity | null) => void;
  onSaved: (saved: SavedGame) => void;
  onPermission: (active: boolean) => void;
};

function activePermission(session: GameplaySession | null, identity: NearIdentity, config: AppConfig) {
  return Boolean(
    session &&
      session.accountId === identity.accountId &&
      session.publicKey === identity.publicKey &&
      session.network === config.network &&
      session.contractId === config.contractId &&
      session.state === 'active' &&
      session.expiresAt > Date.now() &&
      Number.isSafeInteger(session.spent) &&
      session.spent >= 0 &&
      Number.isSafeInteger(session.spendLimit) &&
      session.spent < session.spendLimit,
  );
}
async function settleReads(tasks: Promise<unknown>[]) {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

/** Configuration establishes the session cookie before any parallel reads.
 * Overview and saved-game latency must not delay the Play configuration.
 * All work is read-only; the Play click still owns login and permission. */
export async function loadWelcomeState(callbacks: WelcomeCallbacks): Promise<boolean> {
  const {isCurrent} = callbacks;
  const publish = <T>(callback: (value: T) => void, value: T) => {
    if (isCurrent()) callback(value);
  };
  const config = await cityRequest<AppConfig>('/api/game/config');
  if (!isCurrent()) return false;
  publish(callbacks.onConfig, config);
  if (!isCurrent()) return false;
  const overview = (async () => {
    const snapshot = await cityRequest<GameSnapshot>('/api/game/overview');
    publish(callbacks.onOverview, snapshot);
  })();
  const account = (async () => {
    if (!isCurrent()) return;
    if (config.localMode) {
      publish(callbacks.onPermission, true);
      const saved = await getCitySession();
      publish(callbacks.onSaved, saved);
      return;
    }
    if (!config.authConfigured && !config.guestPlay) {
      publish(callbacks.onIdentity, null);
      publish(callbacks.onPermission, false);
      return;
    }
    const identity = await getNearIdentity();
    if (!isCurrent()) return;
    publish(callbacks.onIdentity, identity);
    publish(callbacks.onPermission, false);
    if (!identity || !isCurrent()) return;
    await settleReads([
      (async () => {
        const session = await getGameplaySession();
        publish(callbacks.onPermission, activePermission(session, identity, config));
      })(),
      (async () => {
        const saved = await getCitySession();
        publish(callbacks.onSaved, saved);
      })(),
    ]);
  })();
  await settleReads([overview, account]);
  return isCurrent() && (config.localMode || config.authConfigured || config.guestPlay);
}
