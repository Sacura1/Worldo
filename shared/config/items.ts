import type {EquipmentKind, Inventory, RawResource, Resource} from '../game';
export const RESOURCES: readonly Resource[] = ['crude_oil', 'petrol', 'rubber', 'wood'];
export const RAW_RESOURCES: readonly RawResource[] = ['crude_oil', 'rubber', 'wood'];
export const emptyInventory = (): Inventory => ({crude_oil: 0, petrol: 0, rubber: 0, wood: 0});
export interface EquipmentConfig {
  name: string;
  category: 'tool' | 'vehicle';
  price: number;
  durability: number;
  resource?: RawResource;
  yield: number;
  gatherMs: number;
  fuelPerUse: number;
  fuelCapacity: number;
  capacity: number;
  speed: number;
  fuelPerMeter: number;
  recipe: {wood: number; rubber: number};
}
const tool = (name: string, resource: RawResource, price: number, powered = false): EquipmentConfig => ({
  name,
  category: 'tool',
  price,
  durability: powered ? 300 : 100,
  resource,
  yield: powered ? 3 : 1,
  gatherMs: 1800,
  fuelPerUse: powered ? 1 : 0,
  fuelCapacity: powered ? 80 : 0,
  capacity: 0,
  speed: 0,
  fuelPerMeter: 0,
  recipe: {wood: powered ? 8 : 3, rubber: powered ? 6 : 1},
});
const vehicle = (
  name: string,
  price: number,
  capacity: number,
  speed: number,
  fuelPerMeter: number,
  wood: number,
  rubber: number,
): EquipmentConfig => ({
  name,
  category: 'vehicle',
  price,
  durability: 300,
  yield: 0,
  gatherMs: 0,
  fuelPerUse: 0,
  fuelCapacity: fuelPerMeter ? 100 : 0,
  capacity,
  speed,
  fuelPerMeter,
  recipe: {wood, rubber},
});
export const ITEMS: Record<EquipmentKind, EquipmentConfig> = {
  hand_pump: tool('Hand pump', 'crude_oil', 75),
  tapping_knife: tool('Tapping knife', 'rubber', 75),
  axe: tool('Axe', 'wood', 75),
  oil_rig: tool('Oil rig', 'crude_oil', 400, true),
  tapping_rig: tool('Tapping rig', 'rubber', 350, true),
  chainsaw: tool('Chainsaw', 'wood', 300, true),
  hand_cart: vehicle('Hand cart', 80, 20, 4.5, 0, 8, 2),
  scooter: vehicle('Scooter', 250, 40, 15, 0.025, 10, 10),
  pickup: vehicle('Pickup', 700, 120, 12, 0.045, 22, 20),
  tanker: vehicle('Tanker', 1500, 400, 10, 0.075, 35, 30),
};
export const STARTER_EQUIPMENT: readonly EquipmentKind[] = ['hand_pump', 'tapping_knife', 'axe', 'hand_cart'];
export const STARTER_COINS = 100;
export const FUEL_CHARGE_PER_PETROL = 20;
export const WALK_SPEED = 5;
export const VEHICLE_WEAR_PER_METER = 0.006;
export const WORN_STARTER_MULTIPLIER = 3;
export const CARGO_UPGRADES = [
  {capacity: 10, cost: 120},
  {capacity: 25, cost: 300},
  {capacity: 50, cost: 600},
] as const;
export const WAREHOUSE_UPGRADES = [
  {capacity: 80, cost: 180},
  {capacity: 200, cost: 450},
  {capacity: 500, cost: 900},
] as const;
export const STORAGE_RENT = 8;
export const STORAGE_RENT_MS = 60 * 60 * 1000;
