import {nearNetworkConfiguration} from './near-config';
import {assertAccountReady} from './production-readiness';
import {Router} from 'express';
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {neon} from '@neondatabase/serverless';
import {verifyQuoteSignature, type QuoteResponse} from '@defuse-protocol/one-click-sdk-typescript';
import {getVerifiedIdentity, nearConfiguration, sessionId, nearRpc, viewContract} from './near';

const API = 'https://1click.chaindefuser.com/v0';
export const DESTINATION_ASSET = 'nep141:wrap.near';
export interface IntentToken {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  price?: number | string;
}
const EVM = new Set([
  'eth',
  'base',
  'arb',
  'op',
  'pol',
  'bsc',
  'avax',
  'gnosis',
  'bera',
  'xlayer',
  'monad',
  'plasma',
  'scroll',
]);
const SUPPORTED = new Set([...EVM, 'near', 'sol', 'btc']);
type RecordData = {
  id: string;
  owner: string;
  createdAt: number;
  request: Record<string, unknown>;
  response: QuoteResponse;
};
let cachedTokens: {at: number; tokens: IntentToken[]} | undefined;
let schemaPromise: Promise<unknown> | undefined;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function toAtomicAmount(value: unknown, decimals: number): string {
  if (
    typeof value !== 'string' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 30 ||
    !/^\d{1,20}(\.\d{1,30})?$/.test(value)
  )
    throw new Error('Enter a positive amount without exponent notation.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`This token supports ${decimals} decimal places.`);
  const amount = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (amount <= 0n || amount > 10n ** 48n) throw new Error('Enter a positive amount within the supported range.');
  return amount.toString();
}
export function validRefundAddress(chain: string, address: unknown): address is string {
  if (typeof address !== 'string' || address.length > 128) return false;
  if (EVM.has(chain)) return /^0x[\da-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address);
  if (chain === 'near')
    return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(address) && address.length >= 2 && address.length <= 64;
  if (chain === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  if (chain === 'btc') return /^(bc1[ac-hj-np-z02-9]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(address);
  return false;
}
async function callApi(route: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.NEAR_INTENTS_API_KEY ? {'X-API-Key': process.env.NEAR_INTENTS_API_KEY} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    let message = 'The route is temporarily unavailable.';
    try {
      const data = (await response.json()) as {message?: string};
      if (typeof data.message === 'string') message = data.message.slice(0, 240);
    } catch {
      /* upstream can return HTML */
    }
    throw new Error(message);
  }
  return response.json();
}
export async function supportedTokens(): Promise<IntentToken[]> {
  if (cachedTokens && Date.now() - cachedTokens.at < 5 * 60_000) return cachedTokens.tokens;
  const data = await callApi('/tokens');
  if (!Array.isArray(data)) throw new Error('Token list unavailable.');
  const tokens = data.filter(
    (t): t is IntentToken =>
      t &&
      typeof t.assetId === 'string' &&
      typeof t.symbol === 'string' &&
      SUPPORTED.has(t.blockchain) &&
      Number.isInteger(t.decimals) &&
      t.decimals >= 0 &&
      t.decimals <= 30,
  );
  if (!tokens.some(t => t.assetId === DESTINATION_ASSET)) throw new Error('NEAR funding is temporarily unavailable.');
  cachedTokens = {tokens, at: Date.now()};
  return tokens;
}
async function saveRecord(record: RecordData) {
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    schemaPromise ??=
      sql`CREATE TABLE IF NOT EXISTS worldo_intent_quotes (id uuid PRIMARY KEY, owner text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`.catch(
        error => {
          schemaPromise = undefined;
          throw error;
        },
      );
    await schemaPromise;
    await sql`INSERT INTO worldo_intent_quotes(id,owner,data) VALUES(${record.id},${record.owner},${JSON.stringify(record)}::jsonb)`;
    return;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Durable payment storage is not configured.');
  const folder = path.resolve('.local/intents');
  await mkdir(folder, {recursive: true});
  const destination = path.join(folder, `${record.id}.json`);
  await writeFile(`${destination}.tmp`, JSON.stringify(record), {mode: 0o600});
  await rename(`${destination}.tmp`, destination);
}
async function loadRecord(id: string): Promise<RecordData | null> {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(id)) return null;
  if (process.env.DATABASE_URL) {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT data FROM worldo_intent_quotes WHERE id=${id}`;
    return (rows[0]?.data as RecordData) || null;
  }
  try {
    return JSON.parse(await readFile(path.resolve('.local/intents', `${id}.json`), 'utf8')) as RecordData;
  } catch {
    return null;
  }
}
export function assertQuoteMatches(request: Record<string, unknown>, response: QuoteResponse) {
  if (!verifyQuoteSignature(response)) throw new Error('The quote signature could not be verified.');
  const echoed = response.quoteRequest as unknown as Record<string, unknown>;
  for (const key of [
    'dry',
    'swapType',
    'originAsset',
    'destinationAsset',
    'amount',
    'recipient',
    'recipientType',
    'refundTo',
    'refundType',
    'slippageTolerance',
    'deadline',
  ])
    if (echoed[key] !== request[key]) throw new Error('The quote does not match the requested transfer.');
  const timestamp = Date.parse(response.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000)
    throw new Error('This quote has expired.');
  if (!request.dry && (!response.quote.depositAddress || Date.parse(response.quote.deadline || '') <= Date.now()))
    throw new Error('The quote has no valid deposit instructions.');
}
export function createIntentsRouter() {
  const router = Router();
  router.use((_req, res, next) => {
    if (!nearNetworkConfiguration().intentsEnabled) {
      res
        .status(409)
        .json({
          error:
            'NEAR Intents has no testnet deployment. Use test NEAR for this testnet world; cross-chain funding is available only in mainnet mode.',
          network: 'testnet',
          available: false,
        });
      return;
    }
    next();
  });
  router.get('/tokens', async (_req, res) => {
    try {
      res.json({tokens: await supportedTokens(), destinationAsset: DESTINATION_ASSET});
    } catch {
      res.status(503).json({error: 'Supported assets could not be loaded. Try again shortly.'});
    }
  });
  router.post('/quote', async (req, res) => {
    const dry = req.body?.dry !== false,
      identity = getVerifiedIdentity(req);
    if (!dry) {
      try {
        await assertAccountReady();
      } catch {
        res.status(503).json({error: 'Funding is unavailable until Worldo’s mainnet setup has been verified.'});
        return;
      }
    }
    if (!dry && (!nearConfiguration().liveEnabled || !identity)) {
      res.status(403).json({error: 'Mainnet funding requires verified sign-in and an enabled deployment.'});
      return;
    }
    if (!dry && process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
      res.status(503).json({error: 'Payment storage is not configured.'});
      return;
    }
    try {
      if (!dry && identity) {
        await nearRpc({request_type: 'view_account', finality: 'final', account_id: identity.accountId});
        const storage = await viewContract('wrap.near', 'storage_balance_of', {account_id: identity.accountId});
        if (!storage) {
          res.status(409).json({error: 'Prepare your wallet before requesting funding instructions.'});
          return;
        }
      }
      const token = (await supportedTokens()).find(t => t.assetId === req.body?.originAsset);
      if (!token || token.assetId === DESTINATION_ASSET) {
        res.status(400).json({error: 'Choose a supported source asset other than NEAR.'});
        return;
      }
      if (!validRefundAddress(token.blockchain, req.body.refundTo)) {
        res.status(400).json({error: `Enter your refund address on ${token.blockchain}.`});
        return;
      }
      const amount = toAtomicAmount(req.body.amount, token.decimals);
      const slippage = req.body.slippageBps ?? 100;
      if (!Number.isInteger(slippage) || slippage < 10 || slippage > 300) {
        res.status(400).json({error: 'Slippage must be between 0.1% and 3%.'});
        return;
      }
      const request = {
        dry,
        swapType: 'EXACT_INPUT',
        slippageTolerance: slippage,
        originAsset: token.assetId,
        destinationAsset: DESTINATION_ASSET,
        amount,
        depositType: 'ORIGIN_CHAIN',
        recipient: identity?.accountId || 'intents.near',
        recipientType: 'DESTINATION_CHAIN',
        refundTo: req.body.refundTo,
        refundType: 'ORIGIN_CHAIN',
        deadline: new Date(Date.now() + (token.blockchain === 'btc' ? 120 : 30) * 60_000).toISOString(),
        quoteWaitingTimeMs: 3000,
      };
      const response = (await callApi('/quote', request)) as QuoteResponse;
      assertQuoteMatches(request, response);
      const id = randomUUID();
      if (!dry) await saveRecord({id, owner: hash(sessionId(req)), createdAt: Date.now(), request, response});
      res.json({
        id,
        dry,
        verified: true,
        request,
        quote: response.quote,
        signature: response.signature,
        timestamp: response.timestamp,
        destinationSymbol: 'wNEAR',
        network: 'mainnet',
      });
    } catch (error) {
      res.status(422).json({error: error instanceof Error ? error.message : 'Unable to obtain a quote.'});
    }
  });
  router.get('/status/:id', async (req, res) => {
    try {
      const record = await loadRecord(String(req.params.id));
      if (!record || record.owner !== hash(sessionId(req))) {
        res.status(404).json({error: 'Funding request not found.'});
        return;
      }
      const address = record.response.quote.depositAddress!;
      const memo = record.response.quote.depositMemo;
      const params = new URLSearchParams({depositAddress: address});
      if (memo) params.set('depositMemo', memo);
      const result = (await callApi(`/status?${params}`)) as {
        status: string;
        quoteResponse: QuoteResponse;
        swapDetails?: Record<string, unknown>;
      };
      // The status is fetched server-to-server. Its enclosed quote must retain the
      // original signed routing, including destination and refund addresses.
      if (
        !verifyQuoteSignature(result.quoteResponse) ||
        result.quoteResponse.quote.depositAddress !== address ||
        result.quoteResponse.quote.depositMemo !== memo
      )
        throw new Error('Funding status could not be verified.');
      for (const key of [
        'dry',
        'swapType',
        'originAsset',
        'destinationAsset',
        'amount',
        'recipient',
        'recipientType',
        'refundTo',
        'refundType',
        'slippageTolerance',
        'deadline',
      ])
        if ((result.quoteResponse.quoteRequest as unknown as Record<string, unknown>)[key] !== record.request[key])
          throw new Error('Funding route changed.');
      res.json({
        id: record.id,
        status: result.status,
        verified: true,
        recipient: record.request.recipient,
        swapDetails: result.swapDetails || {},
        network: 'mainnet',
      });
    } catch {
      res
        .status(503)
        .json({
          error:
            'Funding status is temporarily unavailable. Your deposit instructions remain valid until their deadline.',
        });
    }
  });
  return router;
}
