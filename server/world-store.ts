import {createHash} from 'node:crypto';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {neon, type NeonQueryFunction} from '@neondatabase/serverless';
import type {ChainReceipt, SettlementPlan, SettlementBatch, Transition, WorldData} from '../shared/game';
import {GameError} from './errors';
import {serialized} from './mutex';
import {assertLedger} from './economy/ledger';
import {initializeOwnership} from './economy/ownership';
import {compactOutbox, estimateWorldBatchLogBytes} from '../shared/batches';
import {writeAtomicFile} from './atomic-file';

interface PendingSettlement {
  id: string;
  plan: SettlementPlan;
  candidate: WorldData;
  createdAt: number;
}
interface Envelope {
  revision: number;
  data: WorldData;
  pending: PendingSettlement | null;
  receipts: ChainReceipt[];
  outbox?: SettlementPlan[];
  batch?: SettlementBatch | null;
  settledSequence?: number;
  operations?: Record<string, number>;
  lastBatchError?: string | null;
  lastBatchAt?: number;
  rejected?: {plan: SettlementPlan; rejections: number}[];
}
interface CachedWorld {
  envelope: Envelope;
  persisted: number;
  timer?: ReturnType<typeof setTimeout>;
}
const OPERATION_HISTORY = 2000;
const SOFT_WRITE_DELAY_MS = 5000;
const REJECTIONS_BEFORE_SKIP = 3;
/** Duplicate protection only needs recent player operations. City ticks have
 * random identifiers and can never repeat, so they are not kept at all. */
function keepRecentOperations(operations: Record<string, number>) {
  const ids = Object.keys(operations);
  if (ids.length <= OPERATION_HISTORY) return operations;
  return Object.fromEntries(
    ids
      .filter(id => !id.startsWith('tick:'))
      .slice(-OPERATION_HISTORY)
      .map(id => [id, operations[id]]),
  );
}
export interface ImmediateTransition {
  data: WorldData;
  queued: boolean;
  duplicate: boolean;
}

/** One deployment-scoped record is the atomic unit for all mayors and players.
 * Production uses PostgreSQL CAS. Local JSON is durable but single-process only.
 * Gameplay and outbox entries commit together before broadcasting. A claimed
 * batch remains immutable until its real chain receipt has been reconciled. */
export class WorldStore {
  private sql: NeonQueryFunction<false, false> | null;
  private ready?: Promise<void>;
  /** Database mode only: this process owns the world and CAS still catches any
   * outside writer, so most requests can skip a slow read. */
  private cache = new Map<string, CachedWorld>();
  /** One slow read serves everyone waiting, so a cold start asks the database once. */
  private loading = new Map<string, Promise<Envelope | null>>();
  readonly persistent: boolean;
  constructor(
    private directory = process.env.LOCAL_DATA_DIR
      ? path.join(process.env.LOCAL_DATA_DIR, 'city-worlds')
      : path.resolve('.local/city-worlds'),
    databaseUrl = process.env.DATABASE_URL,
  ) {
    this.directory = path.resolve(directory);
    this.sql = databaseUrl ? neon(databaseUrl) : null;
    this.persistent = !!this.sql;
  }
  private async initialize() {
    if (this.sql)
      await this
        .sql`CREATE TABLE IF NOT EXISTS worldo_city_worlds (scope TEXT PRIMARY KEY, revision BIGINT NOT NULL, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    else await mkdir(this.directory, {recursive: true});
  }
  private ensureInitialized(): Promise<void> {
    // Start only when a caller can observe failure. Share concurrent attempts,
    // but let a later request retry failed setup without replaying any writes.
    return (this.ready ??= this.initialize().catch(error => {
      this.ready = undefined;
      throw error;
    }));
  }
  private file(scope: string) {
    return path.join(this.directory, `${createHash('sha256').update(scope).digest('hex')}.json`);
  }
  private normalize(envelope: Envelope | null) {
    if (envelope) {
      initializeOwnership(envelope.data);
      if (envelope.pending) initializeOwnership(envelope.pending.candidate);
    }
    return envelope;
  }
  private async read(scope: string): Promise<Envelope | null> {
    const cached = this.cache.get(scope);
    if (cached) return cached.envelope;
    if (!this.sql) return this.load(scope);
    let loading = this.loading.get(scope);
    if (!loading) {
      loading = this.load(scope)
        .then(envelope => {
          if (envelope && !this.cache.has(scope)) this.cache.set(scope, {envelope, persisted: envelope.revision});
          return envelope;
        })
        .finally(() => this.loading.delete(scope));
      this.loading.set(scope, loading);
    }
    return loading;
  }
  private async load(scope: string): Promise<Envelope | null> {
    await this.ensureInitialized();
    if (this.sql) {
      const rows = await this.sql`SELECT data FROM worldo_city_worlds WHERE scope=${scope}`;
      return this.normalize((rows[0]?.data as Envelope) ?? null);
    }
    try {
      return this.normalize(JSON.parse(await readFile(this.file(scope), 'utf8')) as Envelope);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  private async write(scope: string, envelope: Envelope) {
    await writeAtomicFile(this.file(scope), JSON.stringify(envelope));
  }
  private async cas(scope: string, revision: number, next: Envelope) {
    if (this.sql) {
      const rows = await this
        .sql`UPDATE worldo_city_worlds SET revision=${next.revision},data=${JSON.stringify(next)}::jsonb,updated_at=now() WHERE scope=${scope} AND revision=${revision} RETURNING scope`;
      return rows.length === 1;
    }
    // File mode is explicitly single-process. change() already holds the whole
    // mutation lock for this resolved directory/scope; this inner lock also
    // coordinates initial create(). No local writer can invalidate the read, so
    // repeating it adds latency without adding protection. PostgreSQL above
    // retains its actual cross-process revision check.
    return serialized(`world:${this.directory}:${scope}`, async () => {
      await this.write(scope, next);
      return true;
    });
  }
  private async change<T>(
    scope: string,
    operation: (current: Envelope) => {next: Envelope; result: T; soft?: boolean},
  ): Promise<T> {
    // Queue a whole read/build/commit in this process. Locking only the final
    // write makes concurrent requests repeatedly rebuild stale worlds and can
    // exhaust the retry budget during an otherwise healthy burst. Keep CAS for
    // database writers in other processes and a separate key from the file lock
    // acquired by cas(), so the nested commit cannot deadlock.
    return serialized(`world-change:${this.directory}:${scope}`, async () => {
      for (let i = 0; i < 16; i++) {
        const old = await this.read(scope);
        const cached = this.sql ? this.cache.get(scope) : undefined;
        if (!old) throw new GameError('This world has not been initialized.', 503);
        const {next, result, soft} = operation(old);
        if (next === old) return result;
        const persisted = cached?.persisted ?? old.revision;
        next.revision = old.revision + 1;
        // Walking and quiet city ticks hold no coins or items. Losing two seconds of
        // them in a crash is harmless, so they wait for the next real write.
        if (this.sql && soft) {
          this.cache.set(scope, {envelope: next, persisted, timer: cached?.timer});
          this.scheduleWrite(scope);
          return result;
        }
        if (await this.cas(scope, persisted, next)) {
          if (cached?.timer) clearTimeout(cached.timer);
          if (this.sql) this.cache.set(scope, {envelope: next, persisted: next.revision});
          return result;
        }
        if (cached?.timer) clearTimeout(cached.timer);
        this.cache.delete(scope);
      }
      throw new GameError('The shared world is busy. Please retry.', 409);
    });
  }
  private scheduleWrite(scope: string) {
    const entry = this.cache.get(scope);
    if (!entry || entry.timer) return;
    entry.timer = setTimeout(() => {
      void this.writeSoftChanges(scope).catch(error =>
        console.warn('World storage write was delayed:', error instanceof Error ? error.message : 'unknown'),
      );
    }, SOFT_WRITE_DELAY_MS);
    entry.timer.unref?.();
  }
  private writeSoftChanges(scope: string) {
    return serialized(`world-change:${this.directory}:${scope}`, async () => {
      const entry = this.cache.get(scope);
      if (!entry) return;
      entry.timer = undefined;
      if (entry.envelope.revision === entry.persisted) return;
      if (await this.cas(scope, entry.persisted, entry.envelope)) entry.persisted = entry.envelope.revision;
      else this.cache.delete(scope);
    });
  }
  async ping() {
    await this.ensureInitialized();
    if (this.sql) await this.sql`SELECT 1`;
  }
  async get(scope: string): Promise<WorldData | null> {
    return (await this.read(scope))?.data ?? null;
  }
  async create(scope: string, seed: WorldData): Promise<WorldData> {
    await this.ensureInitialized();
    if (seed.world.preview) throw new GameError('Simulation snapshots cannot become live worlds.', 400);
    if (scope !== seed.world.id) throw new GameError('World scope does not match its deployment.', 400);
    assertLedger(seed);
    const envelope: Envelope = {revision: 0, data: seed, pending: null, receipts: []};
    if (this.sql) {
      await this
        .sql`INSERT INTO worldo_city_worlds(scope,revision,data) VALUES(${scope},0,${JSON.stringify(envelope)}::jsonb) ON CONFLICT(scope) DO NOTHING`;
      return (await this.get(scope))!;
    }
    return serialized(`world:${this.directory}:${scope}`, async () => {
      const existing = await this.read(scope);
      if (existing) return existing.data;
      await this.write(scope, envelope);
      return seed;
    });
  }
  /** Commits authoritative gameplay and its outbox together. Chain lag never
   * rolls back a player's already accepted trade or freezes movement. */
  async applyImmediate(
    scope: string,
    build: (current: WorldData) => Transition,
    operationId: string,
    enqueue = true,
    options: {soft?: boolean} = {},
  ): Promise<ImmediateTransition> {
    return this.change<ImmediateTransition>(scope, current => {
      if (current.pending)
        throw new GameError('Reconcile the previous settlement journal before switching settlement modes.', 503);
      if (current.operations && Object.hasOwn(current.operations, operationId))
        return {
          next: current,
          result: {data: current.data, queued: !!current.outbox?.some(p => p.id === operationId), duplicate: true},
        };
      const result = build(structuredClone(current.data));
      if (
        result.data.world.preview ||
        result.data.world.id !== scope ||
        result.data.network !== current.data.network ||
        result.data.contractId !== current.data.contractId
      )
        throw new GameError('This action does not belong to the live world.', 400);
      assertLedger(result.data);
      const economic = !!result.plan;
      const tracked = economic && result.plan!.action !== 'tick';
      const next: Envelope = {
        ...current,
        data: result.data,
        outbox: enqueue && economic ? [...(current.outbox ?? []), result.plan!] : (current.outbox ?? []),
        operations: tracked
          ? keepRecentOperations({...(current.operations ?? {}), [operationId]: result.data.world.revision})
          : current.operations,
      };
      return {
        next,
        result: {data: result.data, queued: enqueue && economic, duplicate: false},
        // A tick and its queue entry save together, and nothing is broadcast until a
        // batch is claimed in a full save, so a crash just replays those few seconds.
        soft: options.soft === true && (!economic || result.plan!.action === 'tick'),
      };
    });
  }
  /** Claiming is durable: restart/retry returns the identical immutable batch. */
  async claimBatch(
    scope: string,
    maxPlans = 20,
    options: {tickOnlyIntervalMs?: number} = {},
  ): Promise<SettlementBatch | null> {
    return this.change<SettlementBatch | null>(scope, current => {
      if (current.batch) return {next: current, result: current.batch};
      const queue = compactOutbox(current.outbox ?? []),
        plans: SettlementPlan[] = [];
      let effects = 0;
      // City bookkeeping alone can wait. A player's action never does.
      if (
        queue.length &&
        queue.every(plan => plan.action === 'tick') &&
        Date.now() - (current.lastBatchAt ?? 0) < (options.tickOnlyIntervalMs ?? 0)
      )
        return {next: current, result: null};
      for (const plan of queue.slice(0, Math.max(1, Math.min(100, maxPlans)))) {
        const count =
          plan.transfers.length + plan.mints.length + plan.burns.length + (plan.stationEffects?.length ?? 0);
        const proposed = {
          id: 'batch:999999:' + 'f'.repeat(32),
          sequence: (current.settledSequence ?? 0) + 1,
          previousSequence: current.settledSequence ?? 0,
          plans: [...plans, plan],
          createdAt: Date.now(),
        };
        if (effects + count > 512 || estimateWorldBatchLogBytes(proposed) > 12000) break;
        plans.push(plan);
        effects += count;
      }
      if (!plans.length) {
        if (queue.length) throw new GameError('An outbox operation exceeds the supported batch size.', 503);
        return {next: current, result: null};
      }
      const previousSequence = current.settledSequence ?? 0,
        sequence = previousSequence + 1;
      const digest = createHash('sha256').update(JSON.stringify({scope, sequence, plans})).digest('hex');
      const batch: SettlementBatch = {
        id: `batch:${sequence}:${digest.slice(0, 32)}`,
        sequence,
        previousSequence,
        plans,
        createdAt: Date.now(),
      };
      return {next: {...current, outbox: queue, batch, lastBatchAt: Date.now(), lastBatchError: null}, result: batch};
    });
  }
  async confirmBatch(scope: string, batchId: string, receipt: ChainReceipt): Promise<void> {
    if (
      receipt.operationId !== batchId ||
      !receipt.transactionHash ||
      !/^https:\/\//.test(receipt.explorerUrl) ||
      !Number.isFinite(receipt.confirmedAt)
    )
      throw new GameError('A confirmed batch receipt is required.', 400);
    await this.change(scope, current => {
      if (current.receipts.some(r => r.operationId === batchId)) return {next: current, result: undefined};
      const batch = current.batch;
      if (!batch || batch.id !== batchId) throw new GameError('No matching batch is awaiting settlement.', 409);
      const ids = new Set(batch.plans.map(p => p.id));
      const data = structuredClone(current.data);
      for (const account of new Set(batch.plans.map(p => p.accountId)))
        if (data.players[account]) data.players[account].receipt = receipt;
      return {
        next: {
          ...current,
          data,
          outbox: (current.outbox ?? []).filter(p => !ids.has(p.id)),
          batch: null,
          settledSequence: batch.sequence,
          lastBatchError: null,
          receipts: [...current.receipts.slice(-127), receipt],
        },
        result: undefined,
      };
    });
  }
  /** Failed/uncertain batches remain journaled; dropping one would lose accepted trades. */
  async recordBatchFailure(scope: string, batchId: string, message = 'Chain confirmation is delayed.'): Promise<void> {
    await this.change(scope, current => {
      if (current.batch?.id !== batchId) return {next: current, result: undefined};
      return {next: {...current, lastBatchError: message.slice(0, 240)}, result: undefined};
    });
  }
  /** The contract refused this batch, so it changed nothing. Retry smaller pieces
   * to find the cause. One refused action must never stop every other player. */
  async splitRejectedBatch(scope: string, batchId: string): Promise<void> {
    await this.change(scope, current => {
      const batch = current.batch;
      if (batch?.id !== batchId) return {next: current, result: undefined};
      if (batch.plans.length > 1) {
        const plans = batch.plans.slice(0, Math.ceil(batch.plans.length / 2)),
          digest = createHash('sha256')
            .update(JSON.stringify({scope, sequence: batch.sequence, plans}))
            .digest('hex');
        return {
          next: {
            ...current,
            batch: {...batch, id: `batch:${batch.sequence}:${digest.slice(0, 32)}`, plans},
            lastBatchError: 'A smaller batch is being retried.',
          },
          result: undefined,
        };
      }
      const plan = batch.plans[0],
        rejected = current.rejected ?? [],
        entry = rejected.find(item => item.plan.id === plan.id),
        rejections = (entry?.rejections ?? 0) + 1,
        others = rejected.filter(item => item.plan.id !== plan.id).slice(-49);
      if (rejections < REJECTIONS_BEFORE_SKIP)
        return {
          next: {...current, rejected: [...others, {plan, rejections}], lastBatchError: 'One action is being retried.'},
          result: undefined,
        };
      console.warn('Skipped a refused settlement action', plan.id, plan.action);
      return {
        next: {
          ...current,
          rejected: [...others, {plan, rejections}],
          outbox: (current.outbox ?? []).filter(item => item.id !== plan.id),
          batch: null,
          lastBatchError: null,
        },
        result: undefined,
      };
    });
  }
  async getChainStatus(scope: string) {
    const current = await this.read(scope);
    return {
      queued: current?.outbox?.length ?? 0,
      pendingBatch: current?.batch ?? null,
      lastSettledBatch: current?.receipts.filter(r => r.operationId.startsWith('batch:')).at(-1) ?? null,
      settledSequence: current?.settledSequence ?? 0,
      lastError: current?.lastBatchError ?? null,
    };
  }
}
