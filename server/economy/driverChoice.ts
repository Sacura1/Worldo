import type {DriverState, Position} from '../../shared/game';
import {DISTANCE_COST, DRIVER_VARIATION, LOYALTY_BONUS, WAIT_COST_PER_CAR} from '../../shared/config/stations';
export interface StationChoice {
  id: string;
  position: Position;
  price: number;
  queueLength: number;
  availableLitres: number;
  servingCapacity: number;
  reputation: number;
  playerOwned: boolean;
}
const stableNoise = (key: string) => {
  let hash = 2166136261;
  for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 1000) / 1000;
};
/** Lower score wins. Drivers compare price, actual queue, travel and earned
 * loyalty. Stable per-driver variation avoids a synchronized all-or-nothing
 * crowd without making pricing unpredictable. No spending is decided by AI. */
export function stationScore(driver: DriverState, station: StationChoice): number {
  const waitingCost = station.queueLength * WAIT_COST_PER_CAR;
  const distance = Math.hypot(driver.position.x - station.position.x, driver.position.z - station.position.z);
  const travelCost = distance * DISTANCE_COST;
  const loyalty =
    station.playerOwned && station.reputation > 0 ? LOYALTY_BONUS * Math.min(1, station.reputation / 50) : 0;
  const preference = stableNoise(driver.id + ':' + station.id) * DRIVER_VARIATION;
  return station.price + waitingCost + travelCost - loyalty + preference;
}
export function chooseStation(driver: DriverState, stations: readonly StationChoice[]): StationChoice | null {
  const affordable = stations.filter(
    station =>
      station.servingCapacity > 0 &&
      station.availableLitres >= driver.litresWanted &&
      station.price * driver.litresWanted <= driver.coins,
  );
  affordable.sort((a, b) => stationScore(driver, a) - stationScore(driver, b) || a.id.localeCompare(b.id));
  return affordable[0] ?? null;
}
