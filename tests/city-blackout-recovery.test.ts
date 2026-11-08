import {describe, expect, it} from 'vitest';
import {createWorld} from '../server/economy/index';
import {advanceStations} from '../server/economy/stations';
import {newPlan} from '../server/economy/ledger';

const now = 1800000000000;
const world = () =>
  createWorld({
    network: 'testnet',
    contractId: 'items.testnet',
    cityAccounts: {refinery: 'refinery.testnet', motor: 'motor.testnet', harbor: 'harbor.testnet'},
    now,
  });
/** Every driver in the city is waiting at its pump with money and an empty tank. */
function queueEveryDriver(data: ReturnType<typeof world>, cityId: 'refinery' | 'motor' | 'harbor') {
  for (const driver of data.world.cities[cityId].drivers) {
    driver.phase = 'queued';
    driver.stationId = `city:${cityId}`;
    driver.readyAt = now;
    driver.coins = 1000;
    driver.litresWanted = 3;
  }
}
function runPump(data: ReturnType<typeof world>, seconds: number) {
  for (let step = 1; step <= seconds / 5; step++) {
    data.world.simulatedAt = now + step * 5000;
    advanceStations(data, newPlan(data, data.contractId, 'tick', data.world.simulatedAt, `tick-${step}`), 5000);
  }
}

describe('a dark city can always be restarted', () => {
  it.each([
    ['refinery', 100],
    ['motor', 80],
    ['harbor', 100],
  ] as const)('a queue at %s never buys the city back below its dark line', (cityId, capacity) => {
    const data = world(),
      city = data.world.cities[cityId];
    city.stock.petrol = 30;
    queueEveryDriver(data, cityId);
    runPump(data, 120);
    // Dark is below 10% fuel. Drivers buy 3 litres at a time and stop before crossing it.
    const darkLine = Math.ceil(capacity / 10);
    expect(city.stock.petrol).toBeGreaterThanOrEqual(darkLine);
    expect(city.stock.petrol).toBeLessThan(darkLine + 3);
  });
  it('keeps fuel a delivery has just made, so a dark city can come back', () => {
    const data = world(),
      refinery = data.world.cities.refinery;
    refinery.stock.petrol = 9;
    queueEveryDriver(data, 'refinery');
    runPump(data, 60);
    expect(refinery.stock.petrol).toBe(9);
  });
});
