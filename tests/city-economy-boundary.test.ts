import {describe, expect, it} from 'vitest';
import {createWorld, registerPlayer, applyAction, advanceWorld, assertLedger} from '../server/economy/index';
import {validateSettlementPlan} from '../server/city-chain';
import {estimateWorldBatchLogBytes} from '../shared/batches';
import type {GameAction, SettlementPlan, WorldData} from '../shared/game';
import {MAX_OFFLINE_MS} from '../shared/config/cities';
import {STATION_BUILD_WOOD} from '../shared/config/stations';

const now = 1800000000000;
const fresh = () =>
  createWorld({
    network: 'testnet',
    contractId: 'items.worldo.testnet',
    cityAccounts: {refinery: 'refinery.worldo.testnet', motor: 'motor.worldo.testnet', harbor: 'harbor.worldo.testnet'},
    now,
  });
const batch = (plans: SettlementPlan[]) => ({
  id: 'batch:1:boundary-check',
  sequence: 1,
  previousSequence: 0,
  plans,
  createdAt: now,
});

describe('gameplay to chain settlement boundary', () => {
  it('produces valid plans for the complete ownership lifecycle, including metadata-only pricing', () => {
    const owner = 'owner.testnet',
      stationId = 'station:harbor:1',
      plans: SettlementPlan[] = [];
    let data = fresh(),
      serial = 0;
    const registration = registerPlayer(data, owner, now, 'boundary-registration');
    data = registration.data;
    plans.push(registration.plan!);
    // Existing proceeds and purchased fuel fixture; gathering provenance remains
    // explicit so construction/repairs must mint harvested inputs before burning.
    data.players[owner].coins += 2000;
    data.world.cities.motor.treasury -= 2000;
    data.players[owner].position = {...data.world.stations[stationId].position};
    const act = (action: GameAction) => {
      const result = applyAction(data, owner, action, now, 'boundary-action-' + ++serial);
      data = result.data;
      expect(result.plan).not.toBeNull();
      plans.push(result.plan!);
    };
    act({type: 'station_buy', stationId, name: 'Boundary Fuel'});
    data.players[owner].inventory.wood = STATION_BUILD_WOOD + 30;
    data.players[owner].unminted.wood = STATION_BUILD_WOOD + 30;
    act({type: 'station_build', stationId, quantity: STATION_BUILD_WOOD});
    data.players[owner].inventory.petrol = 100;
    act({type: 'station_stock', stationId, quantity: 100});
    act({type: 'station_price', stationId, price: 14});
    data.world.stations[stationId].pumpDurability = 80;
    data.players[owner].inventory.rubber = 11;
    data.players[owner].unminted.rubber = 11;
    act({type: 'station_repair', stationId, quantity: 1});
    act({type: 'station_upgrade', stationId});
    const tick = advanceWorld(data, now + MAX_OFFLINE_MS, 'boundary-offline-tick');
    plans.push(tick.plan!);
    assertLedger(tick.data);
    for (const plan of plans) expect(() => validateSettlementPlan(plan), plan.action).not.toThrow();
    expect(plans.find(p => p.action === 'station_price')?.metadata.requiresSync).toBe(true);
    expect(estimateWorldBatchLogBytes(batch(plans))).toBeLessThan(12000);
  });
  it('keeps a full six-station offline tick inside the actual chain effect and log budgets', () => {
    let data: WorldData = fresh();
    for (const [i, stationId] of Object.keys(data.world.stations).entries()) {
      const owner = `owner-${i}.testnet`;
      data = registerPlayer(data, owner, now, 'boundary-register-' + i).data;
      data.players[owner].coins += 1000;
      data.world.cities.motor.treasury -= 1000;
      data.players[owner].position = {...data.world.stations[stationId].position};
      data = applyAction(data, owner, {type: 'station_buy', stationId}, now, 'boundary-buy-' + i).data;
      data.players[owner].inventory.wood = STATION_BUILD_WOOD;
      data.players[owner].unminted.wood = STATION_BUILD_WOOD;
      data = applyAction(
        data,
        owner,
        {type: 'station_build', stationId, quantity: STATION_BUILD_WOOD},
        now,
        'boundary-build-' + i,
      ).data;
      data.players[owner].inventory.petrol = 500;
      data = applyAction(
        data,
        owner,
        {type: 'station_stock', stationId, quantity: 500},
        now,
        'boundary-stock-' + i,
      ).data;
      data = applyAction(data, owner, {type: 'station_price', stationId, price: 10}, now, 'boundary-price-' + i).data;
    }
    const result = advanceWorld(data, now + MAX_OFFLINE_MS, 'boundary-six-station-tick');
    expect(result.plan).not.toBeNull();
    assertLedger(result.data);
    expect(() => validateSettlementPlan(result.plan!)).not.toThrow();
    expect(result.plan!.stationEffects?.every(effect => effect.petrolDelta < 0)).toBe(true);
    expect(estimateWorldBatchLogBytes(batch([result.plan!]))).toBeLessThan(12000);
  });
});
