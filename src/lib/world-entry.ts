import {authorizeGameplaySession, loginNear, type NearIdentity} from './near-auth';
import {cityAction, cityRequest} from './city-api';

export type EntryStage = 'signing-in' | 'preparing' | 'entering';
type EntryOptions = {
  localMode: boolean;
  guest?: boolean;
  identity: NearIdentity | null;
  authorized: boolean;
  signal: AbortSignal;
  onIdentity: (identity: NearIdentity) => void;
  onPermission: () => void;
  onStage: (stage: EntryStage) => void;
};

/** Started by the disclosed Play button. Sign-in and approval leave the page, and
 * CityApp calls this once more on return to finish that click, never on a plain load.
 * Authentication and a confirmed, bounded grant must precede registration. */
export async function enterWorldo(options: EntryOptions) {
  const {signal} = options;
  signal.throwIfAborted();
  let identity = options.identity;
  if (options.guest && !options.localMode && !identity) {
    // Guests skip sign-in. The server prepares a test account.
    options.onStage('preparing');
    identity = (await cityRequest<{identity: NearIdentity}>('/api/near/guest', {}, signal, 60000)).identity;
    signal.throwIfAborted();
    options.onIdentity(identity);
    options.onPermission();
  } else if (!options.localMode) {
    if (!identity) {
      options.onStage('signing-in');
      return await loginNear(signal);
    }
    if (!options.authorized) {
      options.onStage('preparing');
      await authorizeGameplaySession({signal, expectedAccountId: identity.accountId});
      signal.throwIfAborted();
      options.onPermission();
    }
  }
  signal.throwIfAborted();
  options.onStage('entering');
  const snapshot = await cityAction({type: 'register'});
  signal.throwIfAborted();
  if (!options.localMode && snapshot.player.accountId !== identity?.accountId)
    throw new Error('Could not verify your NEAR sign-in. Please try again.');
  return {snapshot, identity};
}
