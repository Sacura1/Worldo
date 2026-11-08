import bs58 from 'bs58';
import {LoginDependencyError, loginDependencyFailure} from './login-dependency';

type PublicKeyRead = {rpcUrl: string; mpcContract: string; authContract: string; path: string};

/** Login-only, read-only MPC key lookup. Retry policy lives in NearLogin so a
 * cancelled or superseded attempt cannot initiate another read or save identity. */
export async function readLoginPublicKey(options: PublicKeyRead, request: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await request(options.rpcUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'worldo-login-key',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: options.mpcContract,
          method_name: 'derived_public_key',
          args_base64: Buffer.from(
            JSON.stringify({path: options.path, predecessor: options.authContract, domain_id: 1}),
          ).toString('base64'),
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw loginDependencyFailure(error) ?? new LoginDependencyError('RPC_ERROR', false);
  }
  if (!response.ok)
    throw new LoginDependencyError('RPC_HTTP', response.status === 429 || response.status >= 500, response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LoginDependencyError('RPC_RESPONSE_INVALID', false);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new LoginDependencyError('RPC_RESPONSE_INVALID', false);
  const rpc = body as {error?: unknown; result?: {result?: unknown}};
  if (rpc.error !== undefined) throw new LoginDependencyError('RPC_ERROR', false);
  const bytes = rpc.result?.result;
  if (
    !Array.isArray(bytes) ||
    bytes.length > 4096 ||
    bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)
  )
    throw new LoginDependencyError('RPC_RESPONSE_INVALID', false);
  try {
    const publicKey: unknown = JSON.parse(Buffer.from(bytes).toString());
    if (typeof publicKey !== 'string' || !publicKey.startsWith('ed25519:')) throw new Error();
    const key = bs58.decode(publicKey.slice(8));
    if (key.length !== 32) throw new Error();
    return {publicKey, accountId: Buffer.from(key).toString('hex')};
  } catch {
    throw new LoginDependencyError('DERIVED_KEY_INVALID', false);
  }
}
