import type {PreviewFrame, WorldData} from '../../shared/game';
import {CITY_IDS, DAY_LENGTH_MS} from '../../shared/config/cities';
import {CITY_TRADE_POINTS} from '../../shared/city-layout';
import {applyAction, createWorld, registerPlayer} from './index';
import {advanceWorld} from './citySim';
import {unitPrice} from './pricingRules';
import {assertLedger} from './ledger';
import {STATION_PLOTS} from '../../shared/city-layout';
import {
  STATION_BUILD_FEE,
  STATION_BUILD_WOOD,
  STATION_PLOT_PRICE,
  STATION_REPAIR_PER_RUBBER,
} from '../../shared/config/stations';
import {reservedDriverCoins} from './ownership';
import {GameError} from '../errors';

export const PREVIEW_ACCOUNT = 'preview-convoy.worldo';
/** A reproducible, isolated scenario using the deployment's network and account
 * identities. It deliberately does not copy player assets or occupied plots:
 * every visitor can demonstrate construction and competition, even after the
 * live world has matured. WorldStore rejects the preview marker on every write. */
export function createPreview(source: WorldData): WorldData {
  let data = createWorld({
    network: source.network,
    contractId: source.contractId,
    cityAccounts: Object.fromEntries(CITY_IDS.map(id => [id, source.world.cities[id].accountId])) as Record<
      (typeof CITY_IDS)[number],
      string
    >,
    now: source.world.updatedAt,
  });
  data.world.preview = true;
  data.preview = {startedAt: data.world.updatedAt, lastSupplyAt: data.world.updatedAt, deliveries: 0};
  if (!data.players[PREVIEW_ACCOUNT] && data.world.starterPool - reservedDriverCoins(data) >= 100)
    data = registerPlayer(data, PREVIEW_ACCOUNT, data.world.updatedAt, 'preview:register').data;
  const investor = data.players[PREVIEW_ACCOUNT];
  if (investor) {
    // Explicitly seeded demonstration capital comes from the finite preview pool.
    const capital = Math.min(900, Math.max(0, data.world.starterPool - reservedDriverCoins(data)));
    data.world.starterPool -= capital;
    investor.coins += capital;
    const plot = Object.values(data.world.stations).find(s => s.cityId === 'harbor' && !s.ownerId);
    if (plot && investor.coins >= STATION_PLOT_PRICE + STATION_BUILD_FEE) {
      investor.position = {...plot.position};
      data = applyAction(
        data,
        PREVIEW_ACCOUNT,
        {type: 'station_buy', stationId: plot.id, name: 'Convoy Fuel'},
        data.world.updatedAt,
        'preview:station-buy',
      ).data;
      const player = data.players[PREVIEW_ACCOUNT];
      player.inventory.wood = 20;
      player.unminted.wood = 20;
      data = applyAction(
        data,
        PREVIEW_ACCOUNT,
        {type: 'station_build', stationId: plot.id, quantity: 20},
        data.world.updatedAt,
        'preview:station-foundation',
      ).data;
    }
  }
  return data;
}
/** Pausable forecast using the live rules. Supply is explicitly synthetic and
 * exists only in this isolated copy. A short opening drought reveals shortages. */
export function advancePreview(source: WorldData, elapsedGameMs: number, supply: boolean): WorldData {
  if (!source.world.preview || !source.preview) throw new Error('Create an isolated preview before advancing it');
  if (!Number.isFinite(elapsedGameMs) || elapsedGameMs <= 0 || elapsedGameMs > 7 * DAY_LENGTH_MS)
    throw new Error('Invalid preview interval');
  let data = structuredClone(source);
  const finish = data.world.updatedAt + elapsedGameMs;
  while (data.world.updatedAt + 5000 <= finish) {
    const before = data.world.updatedAt,
      now = Math.min(finish, before + 140000);
    data = advanceWorld(data, now, 'preview:tick:' + now, {maxElapsedMs: 140000}).data;
    if (data.world.updatedAt === before) break;
    if (
      supply &&
      data.world.updatedAt - data.preview!.startedAt >= DAY_LENGTH_MS / 2 &&
      data.world.updatedAt - data.preview!.lastSupplyAt >= 120000 &&
      data.players[PREVIEW_ACCOUNT]
    ) {
      const large = data.preview!.deliveries === 0;
      for (const [cityId, resource, quantity] of [
        ['refinery', 'crude_oil', large ? 60 : 14],
        ['motor', 'petrol', large ? 30 : 2],
        ['harbor', 'petrol', large ? 30 : 2],
        ['motor', 'rubber', 12],
        ['motor', 'wood', 10],
        ['harbor', 'wood', 10],
        ['harbor', 'rubber', 3],
      ] as const) {
        // Refresh after every immutable transition; never retain a stale player ref.
        const cargo = data.players[PREVIEW_ACCOUNT];
        cargo.position = {...CITY_TRADE_POINTS[cityId]};
        cargo.inventory[resource] += quantity;
        if (resource !== 'petrol') cargo.unminted[resource] += quantity;
        data = applyAction(
          data,
          PREVIEW_ACCOUNT,
          {type: 'donate', cityId, resource, quantity},
          now,
          'preview:convoy:' + now + ':' + cityId + ':' + resource,
        ).data;
      }
      data.preview!.lastSupplyAt = now;
      data.preview!.deliveries++;
      const station = Object.values(data.world.stations).find(s => s.ownerId === PREVIEW_ACCOUNT);
      if (station) {
        const wasBuilt = station.progress >= 100;
        let supplier = data.players[PREVIEW_ACCOUNT];
        supplier.position = {...station.position};
        if (station.progress < 100) {
          const quantity = Math.min(20, STATION_BUILD_WOOD - station.woodDelivered);
          supplier.inventory.wood += quantity;
          supplier.unminted.wood += quantity;
          data = applyAction(
            data,
            PREVIEW_ACCOUNT,
            {type: 'station_build', stationId: station.id, quantity},
            now,
            'preview:station-build:' + now,
          ).data;
        }
        const built = data.world.stations[station.id];
        if (built.progress >= 100) {
          supplier = data.players[PREVIEW_ACCOUNT];
          const quantity = Math.min(30, built.tankCapacity - built.tank);
          if (quantity > 0) {
            supplier.inventory.petrol += quantity;
            data = applyAction(
              data,
              PREVIEW_ACCOUNT,
              {type: 'station_stock', stationId: built.id, quantity},
              now,
              'preview:station-stock:' + now,
            ).data;
          }
          if (!wasBuilt)
            data = applyAction(
              data,
              PREVIEW_ACCOUNT,
              {type: 'station_price', stationId: built.id, price: 24},
              now,
              'preview:station-price:' + now,
            ).data;
          if (built.pumpDurability < 60) {
            const rubber = Math.ceil((100 - built.pumpDurability) / STATION_REPAIR_PER_RUBBER);
            supplier = data.players[PREVIEW_ACCOUNT];
            supplier.inventory.rubber += rubber;
            supplier.unminted.rubber += rubber;
            data = applyAction(
              data,
              PREVIEW_ACCOUNT,
              {type: 'station_repair', stationId: built.id, quantity: rubber},
              now,
              'preview:station-repair:' + now,
            ).data;
          }
        }
      }
    }
  }
  assertLedger(data);
  return data;
}
/** Judge-controlled pricing uses the actual station action, in an isolated world. */
export function previewSetPrice(source: WorldData, stationId: string, price: number): WorldData {
  if (!source.world.preview) throw new GameError('Only a simulated station price can be changed here.', 403);
  const data = structuredClone(source),
    station = data.world.stations[stationId],
    owner = data.players[PREVIEW_ACCOUNT];
  if (!station || station.ownerId !== PREVIEW_ACCOUNT || !owner)
    throw new GameError('Only a simulated station price can be changed here.', 403);
  owner.position = {...station.position};
  return applyAction(
    data,
    PREVIEW_ACCOUNT,
    {type: 'station_price', stationId, price},
    Math.max(data.world.updatedAt, owner.lastActiveAt),
    'preview:price:' + data.world.revision,
  ).data;
}
/** One in-game week (~60 video seconds). No chain or persistence I/O exists here. */
export function simulateWeek(source: WorldData, frameCount = 60): PreviewFrame[] {
  if (!Number.isInteger(frameCount) || frameCount < 14 || frameCount > 120)
    throw new Error('Preview frame count must be between 14 and 120');
  let data = createPreview(source);
  const start = data.world.updatedAt,
    frames: PreviewFrame[] = [];
  const capture = () =>
    frames.push({
      elapsedMs: data.world.updatedAt - start,
      world: structuredClone(data.world),
      prices: Object.fromEntries(
        CITY_IDS.map(id => [id, unitPrice(data.world.cities[id], 'petrol', 'sell')]),
      ) as PreviewFrame['prices'],
    });
  capture();
  for (let i = 1; i <= frameCount; i++) {
    const target = start + Math.floor((i * 7 * DAY_LENGTH_MS) / frameCount);
    data = advancePreview(data, target - data.world.updatedAt, i >= Math.ceil(frameCount * 0.25));
    capture();
  }
  return frames;
}
