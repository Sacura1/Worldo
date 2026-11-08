import {afterEach, describe, expect, it, vi} from 'vitest';
import {cityAction, cityRequest} from '../src/lib/city-api';
afterEach(() => vi.unstubAllGlobals());
describe('client action delivery', () => {
  it('cancels a longer funding-readiness read immediately when its panel closes', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(
      (_path: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal!;
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), {once: true});
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const request = cityRequest('/api/near/status?readiness=1', undefined, controller.signal, 60000);
    controller.abort();
    await expect(request).rejects.toMatchObject({status: 0});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retries a lost response with the original operation identity', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(Response.json({snapshot: {player: {coins: 42}}, queued: true}));
    vi.stubGlobal('fetch', fetch);
    expect(
      await cityAction(
        {type: 'station_price', stationId: 'station:harbor:1', price: 12},
        '11111111-1111-4111-8111-111111111111',
      ),
    ).toEqual({player: {coins: 42}});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(JSON.parse(fetch.mock.calls[1][1].body).operationId).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('does not resubmit rejected purchases', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({error: 'You need more coins for this purchase.'}, {status: 409}));
    vi.stubGlobal('fetch', fetch);
    await expect(cityAction({type: 'station_buy', stationId: 'station:harbor:1'})).rejects.toThrow('more coins');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
