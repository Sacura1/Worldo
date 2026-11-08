import {neon} from '@neondatabase/serverless';
import {mkdir, readFile} from 'node:fs/promises';
import {writeAtomicFile} from './atomic-file';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PublicKey} from '@near-js/crypto';
import {serialized} from './mutex';
import {nearNetworkConfiguration} from './near-config';
import type {SettlementPlan} from '../shared/game';
import {GAMEPLAY_SESSION_MS, GAMEPLAY_SPEND_LIMIT} from '../shared/gameplay-permission';
export {GAMEPLAY_SESSION_MS, GAMEPLAY_SPEND_LIMIT} from '../shared/gameplay-permission';
export interface GameplaySession {
  accountId: string;
  publicKey: string;
  contractId: string;
  network: string;
  expiresAt: number;
  spendLimit: number;
  state: 'pending' | 'active' | 'revoked';
  createdAt: number;
  authorizedAt: number;
  spent: number;
}
let initialized: Promise<unknown> | undefined;
function key(accountId: string, publicKey: string) {
  return [nearNetworkConfiguration().network, process.env.NEAR_CONTRACT_ID, accountId, publicKey].join(':');
}
async function sqlClient() {
  const sql = neon(process.env.DATABASE_URL!);
  initialized ??=
    sql`CREATE TABLE IF NOT EXISTS worldo_gameplay_sessions (id text PRIMARY KEY, payload jsonb NOT NULL)`.catch(e => {
      initialized = undefined;
      throw e;
    });
  await initialized;
  return sql;
}
function fileFor(id: string) {
  const base = process.env.LOCAL_DATA_DIR || path.resolve('.local/worldo-testnet');
  return path.join(base, 'gameplay-sessions', createHash('sha256').update(id).digest('hex') + '.json');
}
export async function loadGameplaySession(accountId: string, publicKey: string): Promise<GameplaySession | null> {
  const id = key(accountId, publicKey);
  if (process.env.DATABASE_URL) {
    const sql = await sqlClient();
    const rows = await sql`SELECT payload FROM worldo_gameplay_sessions WHERE id=${id}`;
    return (rows[0]?.payload as GameplaySession) || null;
  }
  if (!nearNetworkConfiguration().testnet) throw new Error('Durable gameplay session storage is not configured.');
  try {
    return JSON.parse(await readFile(fileFor(id), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function saveGameplaySession(session: GameplaySession) {
  const id = key(session.accountId, session.publicKey);
  await serialized('gameplay-session:' + id, async () => {
    if (process.env.DATABASE_URL) {
      const sql = await sqlClient();
      await sql`INSERT INTO worldo_gameplay_sessions(id,payload) VALUES(${id},${JSON.stringify(session)}::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`;
      return;
    }
    if (!nearNetworkConfiguration().testnet) throw new Error('Durable gameplay session storage is not configured.');
    const file = fileFor(id);
    await mkdir(path.dirname(file), {recursive: true});
    await writeAtomicFile(file, JSON.stringify(session), {mode: 0o600});
  });
}
/** Lets a guest return to the same save. The record holds an account name and never a key. */
export interface GuestRecord {
  accountId: string;
  publicKey: string;
}
export async function loadGuestRecord(sessionHash: string): Promise<GuestRecord | null> {
  const id = key('guest-session', sessionHash);
  if (process.env.DATABASE_URL) {
    const sql = await sqlClient();
    const rows = await sql`SELECT payload FROM worldo_gameplay_sessions WHERE id=${id}`;
    return (rows[0]?.payload as GuestRecord) || null;
  }
  try {
    return JSON.parse(await readFile(fileFor(id), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export async function saveGuestRecord(sessionHash: string, record: GuestRecord) {
  const id = key('guest-session', sessionHash);
  if (process.env.DATABASE_URL) {
    const sql = await sqlClient();
    await sql`INSERT INTO worldo_gameplay_sessions(id,payload) VALUES(${id},${JSON.stringify(record)}::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`;
    return;
  }
  const file = fileFor(id);
  await mkdir(path.dirname(file), {recursive: true});
  await writeAtomicFile(file, JSON.stringify(record), {mode: 0o600});
}
export async function prepareGameplaySession(accountId: string, publicKey: string) {
  const parsed = PublicKey.fromString(publicKey);
  if (parsed.keyType !== 0 || parsed.data.length !== 32) throw new Error('Gameplay identity must use Ed25519.');
  const now = Date.now();
  const session: GameplaySession = {
    accountId,
    publicKey,
    contractId: process.env.NEAR_CONTRACT_ID!,
    network: nearNetworkConfiguration().network,
    expiresAt: now + GAMEPLAY_SESSION_MS,
    spendLimit: GAMEPLAY_SPEND_LIMIT,
    state: 'pending',
    createdAt: now,
    authorizedAt: now,
    spent: 0,
  };
  return session;
}
export async function assertCityGameAuthorization(accountId: string): Promise<GameplaySession> {
  const session = await loadGameplaySession(accountId, 'game-authority');
  if (
    !session ||
    session.state !== 'active' ||
    session.expiresAt <= Date.now() ||
    session.contractId !== process.env.NEAR_CONTRACT_ID ||
    session.network !== nearNetworkConfiguration().network
  )
    throw new Error('Authorize Worldo game-token settlement before playing.');
  return session;
}
/** reservedTotal includes all accepted actions since this grant, settled or queued. */
export function validateCityGameAuthorization(
  grant: GameplaySession,
  plan: SettlementPlan,
  alreadyReserved: number,
): number {
  if (plan.action === 'tick') return alreadyReserved;
  if (
    grant.state !== 'active' ||
    plan.accountId !== grant.accountId ||
    plan.createdAt > grant.expiresAt ||
    plan.createdAt < grant.authorizedAt - 5000
  )
    throw new Error('The game-token authorization has expired.');
  if (!Number.isSafeInteger(alreadyReserved) || alreadyReserved < 0)
    throw new Error('Invalid authorization reservation.');
  if (plan.transfers.some(t => !Number.isSafeInteger(t.amount) || t.amount <= 0))
    throw new Error('Invalid settlement amount.');
  const debit = plan.transfers
    .filter(t => t.from === plan.accountId && t.tokenId === 'coin')
    .reduce((n, t) => n + t.amount, 0);
  const total = Math.max(grant.spent, alreadyReserved) + debit;
  if (!Number.isSafeInteger(total) || total > grant.spendLimit)
    throw new Error('The game-token spending authorization is exhausted.');
  return total;
}
export async function saveGameAuthority(session: GameplaySession) {
  await saveGameplaySession({...session, publicKey: 'game-authority'});
  await saveGameplaySession(session);
}
