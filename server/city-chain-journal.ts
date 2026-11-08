import {neon} from '@neondatabase/serverless';
import {mkdir, readFile} from 'node:fs/promises';
import {writeAtomicFile} from './atomic-file';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {serialized} from './mutex';
import {nearNetworkConfiguration} from './near-config';
export interface BroadcastAttempt {
  transactionHash: string;
  signerId: string;
  state: 'broadcasting' | 'confirmed' | 'failed' | 'expired';
  createdAt: number;
  confirmedAt?: number;
  delegateMaxBlockHeight?: number;
  finalizedExpiryHeight?: number;
}
export interface BroadcastRecord extends BroadcastAttempt {
  operationId: string;
  signedTransactionBase64?: string;
  previousAttempts?: BroadcastAttempt[];
}
export function broadcastCanBeReplaced(record: BroadcastRecord) {
  return (
    record.state === 'failed' ||
    (record.state === 'expired' &&
      Number.isSafeInteger(record.delegateMaxBlockHeight) &&
      record.delegateMaxBlockHeight! >= 0 &&
      Number.isSafeInteger(record.finalizedExpiryHeight) &&
      record.finalizedExpiryHeight! > record.delegateMaxBlockHeight!)
  );
}
let initialized: Promise<unknown> | undefined;
function id(operationId: string) {
  return nearNetworkConfiguration().network + ':' + process.env.NEAR_CONTRACT_ID + ':' + operationId;
}
function file(key: string) {
  return path.join(
    process.env.LOCAL_DATA_DIR || '.local/worldo-testnet',
    'chain-journal',
    createHash('sha256').update(key).digest('hex') + '.json',
  );
}
async function db() {
  const sql = neon(process.env.DATABASE_URL!);
  initialized ??=
    sql`CREATE TABLE IF NOT EXISTS worldo_city_broadcasts(id text PRIMARY KEY,payload jsonb NOT NULL)`.catch(e => {
      initialized = undefined;
      throw e;
    });
  await initialized;
  return sql;
}
export async function readBroadcast(operationId: string): Promise<BroadcastRecord | null> {
  const key = id(operationId);
  if (process.env.DATABASE_URL) {
    const sql = await db();
    const rows = await sql`SELECT payload FROM worldo_city_broadcasts WHERE id=${key}`;
    return (rows[0]?.payload as BroadcastRecord) || null;
  }
  if (!nearNetworkConfiguration().testnet) throw new Error('Broadcast journal needs durable storage.');
  try {
    return JSON.parse(await readFile(file(key), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function writeBroadcast(record: BroadcastRecord) {
  const key = id(record.operationId);
  await serialized('chain-broadcast:' + key, async () => {
    const old = await readBroadcast(record.operationId),
      replacing = !!old && old.transactionHash !== record.transactionHash;
    if (replacing && !broadcastCanBeReplaced(old!))
      throw new Error('Reconcile the existing broadcast before retrying.');
    if (
      old &&
      !replacing &&
      old.state !== record.state &&
      old.state !== 'broadcasting' &&
      !(old.state === 'expired' && ['confirmed', 'failed'].includes(record.state))
    )
      throw new Error('A finalized broadcast cannot return to an earlier state.');
    // Caller-supplied history is never authoritative. SQL appends the previous
    // stored attempt atomically, so concurrent workers cannot discard its hash.
    const {previousAttempts: _ignored, ...incoming} = record;
    if (process.env.DATABASE_URL) {
      const sql = await db(),
        expectedPreviousHash = replacing ? old!.transactionHash : null;
      const rows =
        await sql`INSERT INTO worldo_city_broadcasts(id,payload) VALUES(${key},${JSON.stringify(incoming)}::jsonb)
    ON CONFLICT(id) DO UPDATE SET payload=CASE
     WHEN worldo_city_broadcasts.payload->>'transactionHash'=EXCLUDED.payload->>'transactionHash' THEN worldo_city_broadcasts.payload || EXCLUDED.payload
     ELSE EXCLUDED.payload || jsonb_build_object('previousAttempts',COALESCE(worldo_city_broadcasts.payload->'previousAttempts','[]'::jsonb) || jsonb_build_array(worldo_city_broadcasts.payload - 'previousAttempts' - 'signedTransactionBase64' - 'operationId')) END
    WHERE (worldo_city_broadcasts.payload->>'transactionHash'=EXCLUDED.payload->>'transactionHash' AND
      (worldo_city_broadcasts.payload->>'state'='broadcasting' OR worldo_city_broadcasts.payload->>'state'=EXCLUDED.payload->>'state' OR worldo_city_broadcasts.payload->>'state'='expired' AND EXCLUDED.payload->>'state' IN ('confirmed','failed')))
     OR (worldo_city_broadcasts.payload->>'transactionHash'=${expectedPreviousHash} AND
      (worldo_city_broadcasts.payload->>'state'='failed' OR worldo_city_broadcasts.payload->>'state'='expired' AND
       (worldo_city_broadcasts.payload->>'finalizedExpiryHeight')::bigint>(worldo_city_broadcasts.payload->>'delegateMaxBlockHeight')::bigint))
    RETURNING id`;
      if (!rows.length)
        throw new Error('Another settler has already journaled this batch. Reconcile it before retrying.');
      return;
    }
    let saved: BroadcastRecord;
    if (replacing) {
      const {operationId: _id, signedTransactionBase64: _bytes, previousAttempts: _history, ...attempt} = old!;
      saved = {...incoming, previousAttempts: [...(old!.previousAttempts || []), attempt]};
    } else saved = {...old, ...incoming, previousAttempts: old?.previousAttempts};
    const target = file(key);
    await mkdir(path.dirname(target), {recursive: true});
    await writeAtomicFile(target, JSON.stringify(saved), {mode: 0o600});
  });
}
