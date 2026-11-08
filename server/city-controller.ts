import {randomUUID} from 'node:crypto';
import type {Request} from 'express';
import type {ChainReceipt, CityId, GameAction, GameSnapshot, SettlementBatch, WorldData} from '../shared/game';
import {CITY_START_POSITION} from '../shared/city-layout';
import {emptyInventory} from '../shared/config/items';
import {CITY_IDS, SIM_TICK_MS} from '../shared/config/cities';
import {advanceWorld, applyAction, createWorld, registerPlayer, snapshot} from './economy/index';
import {applyMayorDecision} from './economy/citySim';
import {DEMO_SCENARIO, applyBlackoutScenario, prepareDemoPlayer} from './economy/demoScenario';
import {MayorCouncil} from './mayor-council';
import {WorldStore} from './world-store';
import {GameError} from './errors';
import {getVerifiedIdentity, nearConfiguration} from './near';
import {guestPlayEnabled, nearNetworkConfiguration, canonicalAppOrigin} from './near-config';
import {chainSyncEnabled} from './chain-mode';
import {assertCityGameAuthorization, validateCityGameAuthorization} from './gameplay-sessions';
import * as chain from './city-chain';

type Authorization = Awaited<ReturnType<typeof assertCityGameAuthorization>>;
export interface CityChainGateway {
  accounts: typeof chain.cityAccounts;
  settleBatch: (batch: SettlementBatch) => Promise<ChainReceipt>;
  reconcileBatch: (batch: SettlementBatch) => Promise<{receipt: ChainReceipt | null; safeToAbort: boolean}>;
  authorize: (accountId: string) => Promise<Authorization>;
}
export const defaultCityChain: CityChainGateway = {
  accounts: chain.cityAccounts,
  settleBatch: chain.settleWorldBatch,
  reconcileBatch: chain.reconcileWorldBatch,
  authorize: assertCityGameAuthorization,
};
const LOCAL_ACTIONS = new Set([
  'move',
  'door',
  'vehicle',
  'equip',
  'gather_start',
  'gather_finish',
  'gather_cancel',
  'offline_ack',
]);
/** City bookkeeping alone settles every few minutes. Player actions go in the next batch. */
const TICK_ONLY_SETTLE_MS = 5 * 60_000;
/** Mayors only spend AI requests while someone is actually playing. */
const MAYOR_REVIEW_MS = 10 * 60_000;
const PLAYER_ACTIVE_MS = 30 * 60_000;
export class CityController {
  private initialized?: Promise<WorldData>;
  private intervals: ReturnType<typeof setInterval>[] = [];
  private tickPromise?: Promise<void>;
  private settling = false;
  private reviewing = false;
  private nextMayor = 0;
  private lastPlayerActionAt = 0;
  readonly syncEnabled = chainSyncEnabled();
  readonly network = nearNetworkConfiguration().network as 'testnet' | 'mainnet';
  readonly contractId = this.syncEnabled ? process.env.NEAR_CONTRACT_ID || '' : 'local.worldo';
  readonly scope = this.network + ':' + this.contractId;
  constructor(
    readonly store = new WorldStore(),
    readonly gateway: CityChainGateway = defaultCityChain,
    readonly council = new MayorCouncil(),
  ) {}
  private readonly demo = !this.syncEnabled && process.env.DEMO_SCENARIO === DEMO_SCENARIO;
  private seed() {
    const world = createWorld({
      network: this.network,
      contractId: this.contractId,
      cityAccounts: this.syncEnabled
        ? this.gateway.accounts()
        : {refinery: 'refinery.local', motor: 'motor.local', harbor: 'harbor.local'},
    });
    return this.demo ? applyBlackoutScenario(world) : world;
  }
  private ensureInitialized(): Promise<WorldData> {
    // The server is authoritative for accepted gameplay. Initialization performs
    // no RPC calls: deployment compatibility is checked by the background settler.
    if (!this.initialized)
      this.initialized = (async () => {
        const existing = await this.store.get(this.scope);
        if (existing) return existing;
        return this.store.create(this.scope, this.seed());
      })().catch(e => {
        this.initialized = undefined;
        throw e;
      });
    return this.initialized;
  }
  async initialize(): Promise<WorldData> {
    await this.ensureInitialized();
    return (await this.store.get(this.scope))!;
  }
  configuration() {
    if (!this.syncEnabled)
      return {
        network: this.network,
        contractId: null,
        chainSyncEnabled: false,
        localMode: true,
        authConfigured: false,
        guestPlay: false,
        appOrigin: canonicalAppOrigin(),
      };
    const config = nearConfiguration();
    return {
      network: this.network,
      contractId: this.syncEnabled ? this.contractId : null,
      chainSyncEnabled: this.syncEnabled,
      localMode: !this.syncEnabled,
      authConfigured: this.syncEnabled && config.authConfigured,
      guestPlay: guestPlayEnabled(),
      appOrigin: config.appOrigin,
    };
  }
  account(req: Request) {
    if (!this.syncEnabled) {
      if (!req.sessionId) throw new GameError('Open Worldo to start your local game.', 401);
      return 'visitor-' + req.sessionId.slice(0, 32) + '.worldo';
    }
    const identity = getVerifiedIdentity(req);
    if (!identity) throw new GameError('Sign in to enter Worldo.', 401);
    return identity.accountId;
  }
  async data() {
    return this.initialize();
  }
  async session(accountId: string) {
    await this.tick();
    const data = await this.initialize();
    return {snapshot: data.players[accountId] ? snapshot(data, accountId) : null, chain: await this.chainStatus()};
  }
  async player(req: Request) {
    const account = this.account(req),
      session = await this.session(account);
    if (!session.snapshot) throw new GameError('Enter Worldo before using this service.', 409);
    return session.snapshot;
  }
  /** Freeze the same grant epoch under the action CAS before preparing its
   * owner-signed revocation. Previously accepted nonces remain settleable. */
  async freezeGameAuthority(accountId: string, authorizedAt: number) {
    await this.ensureInitialized();
    const key = accountId + ':' + authorizedAt;
    const result = await this.store.applyImmediate(
      this.scope,
      data => {
        const cutoff = data.revokedAuthorities?.[key] ?? data.players[accountId]?.nonce ?? 0;
        data.revokedAuthorities = {...data.revokedAuthorities, [key]: cutoff};
        return {data, plan: null};
      },
      'revoke:' + randomUUID(),
      false,
    );
    return {lastAcceptedNonce: result.data.revokedAuthorities![key]};
  }
  async action(accountId: string, action: GameAction | {type: 'register'}, operationId: string) {
    await this.ensureInitialized();
    let grant: Authorization | undefined;
    this.lastPlayerActionAt = Date.now();
    if (this.syncEnabled && !LOCAL_ACTIONS.has(action.type)) {
      try {
        grant = await this.gateway.authorize(accountId);
      } catch {
        throw new GameError('Authorize Worldo game-token settlement before continuing.', 401);
      }
    }
    const now = Date.now(),
      result = await this.store.applyImmediate(
        this.scope,
        current => {
          if (
            grant &&
            current.revokedAuthorities &&
            Object.hasOwn(current.revokedAuthorities, accountId + ':' + grant.authorizedAt)
          )
            throw new GameError('Authorize Worldo game-token settlement before continuing.', 401);
          const transition =
            action.type === 'register'
              ? registerPlayer(current, accountId, now, operationId)
              : applyAction(current, accountId, action, now, operationId);
          if (this.demo && action.type === 'register' && !current.players[accountId])
            prepareDemoPlayer(transition.data, accountId);
          if (transition.plan && this.syncEnabled) {
            if (!grant) throw new GameError('This action requires a game-token authorization.', 401);
            const key = accountId + ':' + grant.authorizedAt,
              reserved = transition.data.authorizationReservations?.[key] ?? 0;
            try {
              const total = validateCityGameAuthorization(grant, transition.plan, reserved);
              transition.data.authorizationReservations = {...transition.data.authorizationReservations, [key]: total};
              transition.plan.metadata.authorizationAt = grant.authorizedAt;
            } catch {
              throw new GameError(
                'Your game-token authorization has expired or reached its limit. Renew it to continue.',
                403,
              );
            }
          }
          return transition;
        },
        operationId,
        this.syncEnabled,
        {soft: LOCAL_ACTIONS.has(action.type)},
      );
    return {snapshot: snapshot(result.data, accountId), queued: result.queued};
  }
  async tick() {
    if (!this.tickPromise)
      this.tickPromise = (async () => {
        const current = await this.initialize(),
          now = Date.now();
        if (now - current.world.updatedAt < SIM_TICK_MS) return;
        const id = 'tick:' + randomUUID();
        await this.store.applyImmediate(this.scope, data => advanceWorld(data, now, id), id, this.syncEnabled, {
          soft: true,
        });
      })().finally(() => {
        this.tickPromise = undefined;
      });
    return this.tickPromise;
  }
  async settle() {
    if (!this.syncEnabled || this.settling) return;
    this.settling = true;
    let batch: SettlementBatch | null = null;
    try {
      await this.initialize();
      batch = await this.store.claimBatch(this.scope, 20, {tickOnlyIntervalMs: TICK_ONLY_SETTLE_MS});
      if (!batch) return;
      const previous = await this.gateway.reconcileBatch(batch);
      const receipt = previous.receipt ?? (await this.gateway.settleBatch(batch));
      await this.store.confirmBatch(this.scope, batch.id, receipt);
    } catch (error) {
      console.warn('Chain settlement is delayed:', error instanceof Error ? error.message : 'unknown');
      if (batch && error instanceof chain.BatchRejectedError) await this.store.splitRejectedBatch(this.scope, batch.id);
      else if (batch)
        await this.store.recordBatchFailure(
          this.scope,
          batch.id,
          'Chain confirmation is delayed. Accepted game actions remain safely queued.',
        );
    } finally {
      this.settling = false;
    }
  }
  /** One mayor at a time reviews its city with NEAR AI. Its own rules run the city
   * when the AI is missing, slow or wrong, so play never waits for this. */
  async reviewMayor() {
    if (this.reviewing || Date.now() - this.lastPlayerActionAt > PLAYER_ACTIVE_MS) return;
    await this.askMayor(CITY_IDS[this.nextMayor++ % CITY_IDS.length] as CityId);
  }
  private async askMayor(cityId: CityId) {
    if (this.reviewing || !this.council.available(cityId)) return;
    this.reviewing = true;
    try {
      const proposal = await this.council.propose(await this.initialize(), cityId);
      if (!proposal) return;
      await this.store.applyImmediate(
        this.scope,
        data => applyMayorDecision(data, cityId, proposal),
        'mayor:' + randomUUID(),
        this.syncEnabled,
      );
    } catch (error) {
      console.warn('A mayor review was skipped:', error instanceof Error ? error.message : 'unknown');
    } finally {
      this.reviewing = false;
    }
  }
  async chainStatus() {
    if (!this.syncEnabled)
      return {
        enabled: false,
        mode: 'local',
        network: this.network,
        contractId: null,
        status: 'disabled',
        healthy: null,
        queuedActions: 0,
        pendingBatch: null,
        lastSettledBatch: null,
        settledSequence: 0,
        message: null,
      };
    const status = await this.store.getChainStatus(this.scope);
    const oldest = status.pendingBatch?.createdAt ?? 0,
      delayed = !!status.lastError || (!!oldest && Date.now() - oldest > 180000);
    return {
      enabled: true,
      mode: 'enabled',
      network: this.network,
      contractId: this.contractId,
      status: delayed ? 'delayed' : status.queued ? 'pending' : status.lastSettledBatch ? 'synced' : 'unverified',
      healthy: status.lastSettledBatch ? !delayed : null,
      queuedActions: status.queued,
      pendingBatch: status.pendingBatch
        ? {id: status.pendingBatch.id, sequence: status.pendingBatch.sequence, createdAt: status.pendingBatch.createdAt}
        : null,
      lastSettledBatch: status.lastSettledBatch,
      settledSequence: status.settledSequence,
      message: status.lastError,
    };
  }
  start() {
    if (this.intervals.length) return;
    const simulation = setInterval(() => {
      void this.tick().catch(error =>
        console.warn('City simulation is waiting for storage:', error instanceof Error ? error.message : 'unknown'),
      );
    }, 5000);
    simulation.unref();
    this.intervals.push(simulation);
    const mayors = setInterval(() => {
      void this.reviewMayor();
    }, MAYOR_REVIEW_MS);
    // The demo story shows one real NEAR AI decision from the Refinery mayor. It only
    // happens when the demo was given an AI key, so plain local play never spends one.
    if (this.demo) setTimeout(() => void this.askMayor('refinery'), 2000).unref();
    mayors.unref();
    this.intervals.push(mayors);
    if (this.syncEnabled) {
      const settlement = setInterval(() => {
        void this.settle().catch(error =>
          console.warn('Chain settlement is waiting for storage:', error instanceof Error ? error.message : 'unknown'),
        );
      }, 60000);
      settlement.unref();
      this.intervals.push(settlement);
    }
  }
  stop() {
    for (const interval of this.intervals) clearInterval(interval);
    this.intervals = [];
  }
  async overview() {
    const data = await this.initialize();
    return observerSnapshot(data);
  }
}
/** Read-only camera anchor. It receives no grant and owns no assets. */
export function observerSnapshot(data: WorldData): GameSnapshot {
  return {
    world: data.world,
    network: data.network,
    contractId: data.contractId,
    player: {
      accountId: 'observer.worldo',
      coins: 0,
      position: {...CITY_START_POSITION},
      heading: 0,
      driving: false,
      activeVehicleId: '',
      equipment: [],
      inventory: emptyInventory(),
      unminted: {crude_oil: 0, rubber: 0, wood: 0},
      equippedTools: {crude_oil: '', rubber: '', wood: ''},
      warehouse: emptyInventory(),
      warehouseUnminted: {crude_oil: 0, rubber: 0, wood: 0},
      warehouseLevel: 0,
      cargoLevel: 0,
      storagePaidUntil: 0,
      gathering: null,
      lastMoveAt: 0,
      movementCredit: 0,
      joinedAt: 0,
      lastActiveAt: 0,
      nonce: 0,
      purchases: [],
      reputation: {refinery: 0, motor: 0, harbor: 0},
      offlineSummary: {since: data.world.simulatedAt, litresSold: 0, coinsEarned: 0, events: []},
    },
  };
}
