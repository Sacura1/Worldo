import type {
  ChainReceipt,
  GameAction,
  GameSnapshot,
  PriceQuote,
  CityId,
  Resource,
  WorldEventKind,
} from '../../shared/game';
export class CityRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function cityRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<T> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    throw new CityRequestError('The city connection was interrupted. Please try again.', 0);
  }
  const result = await response.json().catch(() => ({error: 'The city connection was interrupted. Please try again.'}));
  if (!response.ok)
    throw new CityRequestError(
      result.error || 'The city connection was interrupted. Please try again.',
      response.status,
    );
  return result;
}
export interface ChainStatus {
  enabled: boolean;
  mode: 'local' | 'enabled';
  network: 'testnet' | 'mainnet';
  contractId: string | null;
  status: 'disabled' | 'unverified' | 'pending' | 'synced' | 'delayed';
  healthy: boolean | null;
  queuedActions: number;
  pendingBatch: {id: string; sequence: number; createdAt: number} | null;
  lastSettledBatch: ChainReceipt | null;
  settledSequence: number;
  message: string | null;
}
export type ActionResult = {snapshot: GameSnapshot; queued: boolean};
/** This waits only for authoritative game persistence, never a chain receipt. */
export async function cityAction(
  action: GameAction | {type: 'register'},
  operationId = crypto.randomUUID(),
): Promise<GameSnapshot> {
  const body = {action, operationId};
  try {
    return (await cityRequest<ActionResult>('/api/game/action', body)).snapshot;
  } catch (error) {
    if (!(error instanceof CityRequestError) || error.status !== 0) throw error;
    // A lost response can follow a successful commit. Reuse its exact operation
    // identity so the durable outbox cannot charge the purchase twice.
    return (await cityRequest<ActionResult>('/api/game/action', body)).snapshot;
  }
}
export const getCitySession = () =>
  cityRequest<{snapshot: GameSnapshot | null; chain: ChainStatus}>('/api/game/session');
export const getChainStatus = () => cityRequest<ChainStatus>('/chain/status');
export const getCityQuote = (
  cityId: CityId,
  resource: Resource,
  side: 'buy' | 'sell',
  quantity: number,
  bountyId?: string,
) => cityRequest<PriceQuote>('/api/game/quote', {cityId, resource, side, quantity, bountyId});
export type PreviewPlot = {
  elapsedMs: number;
  fuel: Record<CityId, number>;
  prices: Record<CityId, number>;
  stationPrices?: Record<CityId, number>;
  marketShare?: Record<CityId, number>;
  event?: WorldEventKind | null;
};
export type PreviewResponse = {
  snapshot: GameSnapshot;
  frames: PreviewPlot[];
  elapsedMs: number;
  scenario: string;
  simulatedSupply: boolean;
};
export const getPreview = () => cityRequest<PreviewResponse>('/api/preview');
export const advancePreview = (seconds: number, supply: boolean, speed: 'fast' | 'live' = 'fast') =>
  cityRequest<PreviewResponse>('/api/preview/advance', {seconds, supply, speed});
export const previewPrice = (stationId: string, price: number) =>
  cityRequest<PreviewResponse>('/api/preview/action', {type: 'station_price', stationId, price});
export const resetPreview = () => cityRequest<PreviewResponse>('/api/preview/reset', {});
