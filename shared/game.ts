/** Canonical city-world protocol. Coins are integer game tokens, never native NEAR. */
export type Network = 'testnet' | 'mainnet';
export type CityId = 'refinery' | 'motor' | 'harbor';
export type Resource = 'crude_oil' | 'petrol' | 'rubber' | 'wood';
export type RawResource = Exclude<Resource, 'petrol'>;
export type Inventory = Record<Resource, number>;
export type FuelState = 'thriving' | 'normal' | 'struggling' | 'dark';
export interface Position {
  x: number;
  z: number;
}
export type EquipmentKind =
  | 'hand_pump'
  | 'tapping_knife'
  | 'axe'
  | 'oil_rig'
  | 'tapping_rig'
  | 'chainsaw'
  | 'hand_cart'
  | 'scooter'
  | 'pickup'
  | 'tanker';
export interface EquipmentInstance {
  id: string;
  kind: EquipmentKind;
  durability: number;
  maxDurability: number;
  fuel: number;
  position?: Position;
  heading?: number;
}
export interface Gathering {
  nodeId: string;
  resource: RawResource;
  toolId: string;
  startedAt: number;
  durationMs: number;
}
export interface ChainReceipt {
  transactionHash: string;
  explorerUrl: string;
  operationId: string;
  confirmedAt: number;
}
export interface PlayerState {
  accountId: string;
  coins: number;
  position: Position;
  heading: number;
  driving: boolean;
  activeVehicleId: string;
  equipment: EquipmentInstance[];
  inventory: Inventory;
  /** Subset of cargo harvested off-chain, minted exactly once at sale. */
  unminted: Record<RawResource, number>;
  equippedTools: Record<RawResource, string>;
  warehouse: Inventory;
  warehouseLevel: number;
  warehouseUnminted: Record<RawResource, number>;
  cargoLevel: number;
  storagePaidUntil: number;
  gathering: Gathering | null;
  lastMoveAt: number;
  movementCredit: number;
  joinedAt: number;
  lastActiveAt: number;
  nonce: number;
  /** Recently bought goods cannot be flipped into the same city's emergency bounty. */
  purchases: {cityId: CityId; resource: Resource; quantity: number; at: number}[];
  reputation: Record<CityId, number>;
  offlineSummary: {since: number; litresSold: number; coinsEarned: number; events: string[]};
  receipt?: ChainReceipt;
}
export interface StationState {
  id: string;
  cityId: CityId;
  ownerId: string | null;
  name: string;
  position: Position;
  progress: number;
  woodDelivered: number;
  buildFeePaid: boolean;
  price: number;
  effectivePrice: number;
  tank: number;
  tankCapacity: number;
  pumpDurability: number;
  queueLength: number;
  protest: number;
  litresSoldToday: number;
  revenueToday: number;
  totalLitresSold: number;
  totalRevenue: number;
  lastSaleAt: number;
}
export interface DriverState {
  id: string;
  cityId: CityId;
  stationId: string | null;
  previousStationId: string | null;
  queueIndex: number;
  phase: 'seeking' | 'travelling' | 'queued' | 'serving' | 'leaving';
  assignedAt: number;
  readyAt: number;
  position: Position;
  coins: number;
  litresWanted: number;
  loyalty: number;
}
export interface SupplyContract {
  id: string;
  cityId: CityId;
  resource: Resource;
  quantityPerDay: number;
  days: number;
  unitPrice: number;
  reservedCoins: number;
  collateral: number;
  collateralHeld: number;
  ownerId: string | null;
  offeredAt: number;
  offerExpiresAt: number;
  acceptedAt: number | null;
  dueAt: number | null;
  deliveredToday: number;
  daysCompleted: number;
  totalDelivered: number;
  status: 'open' | 'active' | 'completed' | 'failed' | 'expired';
}
export interface Bounty {
  id: string;
  resource: Resource;
  unitPrice: number;
  remaining: number;
  reservedCoins: number;
  createdAt: number;
  expiresAt: number;
  reason: 'fuel' | 'rubber' | 'wood';
}
export interface ConstructionPlot {
  id: string;
  progress: number;
  complete: boolean;
  stalled: boolean;
  woodUsed: number;
  rubberUsed: number;
}
export interface CityState {
  id: CityId;
  accountId: string;
  treasury: number;
  recoveryReserve: number;
  stock: Inventory;
  fuelPercent: number;
  state: FuelState;
  stateChangedAt: number;
  fuelBurnRemainder: number;
  productionRemainder: number;
  constructionRemainder: number;
  equipmentStock: Record<EquipmentKind, number>;
  equipmentInventory: EquipmentInstance[];
  bounties: Bounty[];
  prices: {buy: Inventory; sell: Inventory};
  construction: ConstructionPlot[];
  shortageSince: Partial<Record<'fuel' | 'rubber' | 'wood', number>>;
  bountyCooldowns: Partial<Record<'fuel' | 'rubber' | 'wood', number>>;
  demand: Record<Resource, number>;
  protest: number;
  workshopIdle: number;
  shipsWaiting: number;
  productionActive: boolean;
  freightEarned: number;
  drivers: DriverState[];
  marketShare: number;
  marketShareSales: number;
  marketShareTotal: number;
  stationPrice: number;
  fuelCostBasis: number;
  competitionDiscount: number;
  competitionReason: string;
  priceCap: number | null;
  priceCapUntil: number;
  supplyReservedCoins: number;
  lastContractAt: number;
  policy: MayorPolicy;
  importedLitres: number;
  lastImportNoteAt: number;
}
export interface EconomyEvent {
  id: string;
  at: number;
  type: 'fuel_state' | 'bounty' | 'construction' | 'trade' | 'production' | 'recovery' | 'decision' | 'world';
  cityId: CityId;
  message: string;
  resource?: Resource;
  quantity?: number;
}
export type WorldEventKind = 'storm' | 'festival' | 'refinery_fault' | 'oil_boom' | 'cold_snap';
export interface WorldEvent {
  id: string;
  kind: WorldEventKind;
  cityId?: CityId;
  startedAt: number;
  endsAt: number;
}
/** Settings a mayor may change. Coins and goods still move only through game rules. */
export interface MayorPolicy {
  bountyPremium: number;
  wageRate: number;
  fuelReserve: number;
  note: string;
  source: 'rules' | 'near-ai';
  decidedAt: number;
  published: boolean;
}
export interface WorldState {
  id: string;
  revision: number;
  economyRevision: number;
  createdAt: number;
  updatedAt: number;
  simulatedAt: number;
  day: number;
  dayFraction: number;
  cities: Record<CityId, CityState>;
  doors: Record<string, boolean>;
  events: EconomyEvent[];
  starterPool: number;
  initialCoinSupply: number;
  equipmentSerial: number;
  preview: boolean;
  stations: Record<string, StationState>;
  supplyContracts: SupplyContract[];
  event: WorldEvent | null;
  nextEventAt: number;
  eventCount: number;
  lastEventKind?: WorldEventKind;
}
export interface PriceQuote {
  cityId: CityId;
  resource: Resource;
  side: 'buy' | 'sell';
  unitPrice: number;
  quantity: number;
  total: number;
  maxQuantity: number;
  reason: string;
  bountyId?: string;
  available: boolean;
  /** Price of the first and last unit. They differ when an order moves the market. */
  firstUnitPrice: number;
  lastUnitPrice: number;
}
export interface GameSnapshot {
  world: WorldState;
  player: PlayerState;
  network: Network;
  contractId: string;
  receipt?: ChainReceipt;
}
export type GameAction =
  | {type: 'move'; position: Position; heading: number}
  | {type: 'door'; doorId: string; open: boolean}
  | {type: 'vehicle'; equipmentId: string; driving: boolean}
  | {type: 'equip'; equipmentId: string}
  | {type: 'gather_start'; nodeId: string}
  | {type: 'gather_finish'}
  | {type: 'gather_cancel'}
  | {type: 'sell'; cityId: CityId; resource: Resource; quantity: number; bountyId?: string; limit?: number}
  | {type: 'donate'; cityId: CityId; resource: Resource; quantity: number}
  | {type: 'buy'; cityId: CityId; resource: Resource; quantity: number; limit?: number}
  | {type: 'buy_equipment'; kind: EquipmentKind}
  | {type: 'repair'; equipmentId: string}
  | {type: 'refuel'; equipmentId: string; quantity: number}
  | {type: 'upgrade'; kind: 'cargo' | 'warehouse'}
  | {type: 'storage'; direction: 'deposit' | 'withdraw'; resource: Resource; quantity: number}
  | {type: 'rent_storage'}
  | {type: 'station_buy'; stationId: string; name?: string}
  | {type: 'station_build'; stationId: string; quantity: number}
  | {type: 'station_stock'; stationId: string; quantity: number}
  | {type: 'station_price'; stationId: string; price: number}
  | {type: 'station_repair'; stationId: string; quantity: number}
  | {type: 'station_upgrade'; stationId: string}
  | {type: 'contract_accept'; contractId: string}
  | {type: 'contract_deliver'; contractId: string; quantity: number}
  | {type: 'offline_ack'};
export interface TokenTransfer {
  from: string;
  to: string;
  tokenId: string;
  amount: number;
}
export interface TokenMint {
  to: string;
  tokenId: string;
  amount: number;
  reason: 'harvest' | 'manufacture' | 'starter';
}
export interface TokenBurn {
  from: string;
  tokenId: string;
  amount: number;
  reason: 'fuel' | 'production' | 'construction';
}
export interface SettlementPlan {
  id: string;
  accountId: string;
  action: GameAction['type'] | 'register' | 'tick';
  nonce: number;
  createdAt: number;
  expiresAt: number;
  transfers: TokenTransfer[];
  mints: TokenMint[];
  burns: TokenBurn[];
  stationEffects?: {stationId: string; ownerId: string; petrolDelta: number}[];
  metadata: Record<string, string | number | boolean>;
}
export interface WorldData {
  version: 1;
  network: Network;
  contractId: string;
  world: WorldState;
  players: Record<string, PlayerState>;
  preview?: {startedAt: number; lastSupplyAt: number; deliveries: number};
  authorizationReservations?: Record<string, number>;
  revokedAuthorities?: Record<string, number>;
}
export interface Transition {
  data: WorldData;
  plan: SettlementPlan | null;
}
export interface SettlementBatch {
  id: string;
  sequence: number;
  previousSequence: number;
  plans: SettlementPlan[];
  createdAt: number;
}
export interface PreviewFrame {
  elapsedMs: number;
  world: WorldState;
  prices: Record<CityId, number>;
}
