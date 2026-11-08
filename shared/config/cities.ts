import type {CityId, Inventory} from '../game';
export const CITY_IDS: readonly CityId[] = ['refinery', 'motor', 'harbor'];
export interface CityConfig {
  name: string;
  fuelCapacity: number;
  fuelPerSecond: number;
  initialTreasury: number;
  recoveryReserve: number;
  initialStock: Inventory;
  targetStock: Inventory;
  protectedFuel: number;
}
export const CITIES: Record<CityId, CityConfig> = {
  refinery: {
    name: 'Refinery City',
    fuelCapacity: 100,
    fuelPerSecond: 0.025,
    initialTreasury: 12000,
    recoveryReserve: 400,
    initialStock: {crude_oil: 36, petrol: 66, rubber: 0, wood: 0},
    targetStock: {crude_oil: 80, petrol: 100, rubber: 0, wood: 0},
    protectedFuel: 6,
  },
  motor: {
    name: 'Motor City',
    fuelCapacity: 80,
    fuelPerSecond: 0.035,
    initialTreasury: 12000,
    recoveryReserve: 400,
    initialStock: {crude_oil: 0, petrol: 42, rubber: 30, wood: 30},
    targetStock: {crude_oil: 0, petrol: 80, rubber: 70, wood: 55},
    protectedFuel: 3,
  },
  harbor: {
    name: 'Harbor City',
    fuelCapacity: 100,
    fuelPerSecond: 0.045,
    initialTreasury: 12000,
    recoveryReserve: 500,
    initialStock: {crude_oil: 0, petrol: 26, rubber: 8, wood: 16},
    targetStock: {crude_oil: 0, petrol: 100, rubber: 40, wood: 100},
    protectedFuel: 3,
  },
};
export const SIM_TICK_MS = 5000;
/** Offline time progresses at most one hour per catch-up, never weeks of irreversible decline. */
export const MAX_OFFLINE_MS = 60 * 60 * 1000;
export const DAY_LENGTH_MS = 20 * 60 * 1000;
export const INITIAL_DAY_FRACTION = 0.38;
export const STARTER_POOL = 100000;
export const REFINERY_CYCLE_MS = 10000;
export const REFINERY_CRUDE_INPUT = 2;
export const REFINERY_PETROL_OUTPUT = 3;
export const MOTOR_CYCLE_MS = 20000;
export const CONSTRUCTION_PLOTS = 4;
export const CONSTRUCTION_CYCLE_MS = 5000;
export const CONSTRUCTION_PROGRESS_PER_CYCLE = 2.5;
export const CONSTRUCTION_WOOD_PER_CYCLE = 1;
export const CONSTRUCTION_RUBBER_EVERY = 4;
export const BUILDING_FUEL_PER_SECOND = 0.007;
export const SHORTAGE_DELAY_MS = 45000;
export const BOUNTY_LIFETIME_MS = 180000;
export const BOUNTY_COOLDOWN_MS = 120000;
export const BOUNTY_QUANTITY = 20;
export const BOUNTY_PREMIUM = 1.5;
export const SAME_CITY_RESALE_WINDOW_MS = 10 * 60 * 1000;
export const MAYOR_TRADE_INTERVAL_MS = 30000;
export const FREIGHT_FEE_PER_UNIT = 1;
/** A mayor buys costly imported fuel when tanks run low. It keeps a city breathing
 * with no players, but refined petrol from delivered crude is always far cheaper. */
export const IMPORT_INTERVAL_MS = 60000;
export const IMPORT_LITRES = 10;
export const IMPORT_UNIT_PRICE = 20;
/** Refined petrol is what makes prices fall again after a run of imports. */
export const REFINED_UNIT_COST = 6;
export const IMPORT_NOTE_INTERVAL_MS = 10 * 60 * 1000;
export const DEFAULT_FUEL_RESERVE = 20;
