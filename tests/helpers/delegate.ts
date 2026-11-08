import type {DelegateAction} from '@near-js/transactions';

/** The relayer mock receives the delegate exactly as it would be sponsored. */
export function decodeSignedDelegate(call: unknown[]) {
  return {delegate: call[0] as DelegateAction};
}
