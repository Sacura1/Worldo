export type LoginDependencyCode =
  | 'TIMEOUT'
  | 'DNS_UNAVAILABLE'
  | 'CONNECTION_FAILED'
  | 'JWKS_HTTP'
  | 'RPC_HTTP'
  | 'RPC_ERROR'
  | 'RPC_RESPONSE_INVALID'
  | 'DERIVED_KEY_INVALID';
export class LoginDependencyError extends Error {
  constructor(
    readonly code: LoginDependencyCode,
    readonly retryable: boolean,
    readonly httpStatus?: number,
  ) {
    super('The sign-in dependency is unavailable.');
    this.name = 'LoginDependencyError';
  }
}

/** Classify only known transport failures. Provider messages and response bodies
 * must never be copied into logs or player-facing authentication errors. */
export function loginDependencyFailure(error: unknown): LoginDependencyError | undefined {
  if (error instanceof LoginDependencyError) return error;
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const value = current as {name?: unknown; code?: unknown; cause?: unknown};
    if (
      value.name === 'TimeoutError' ||
      value.name === 'AbortError' ||
      value.code === 'ERR_JWKS_TIMEOUT' ||
      value.code === 'ETIMEDOUT' ||
      value.code === 'UND_ERR_CONNECT_TIMEOUT' ||
      value.code === 'UND_ERR_HEADERS_TIMEOUT' ||
      value.code === 'UND_ERR_BODY_TIMEOUT'
    )
      return new LoginDependencyError('TIMEOUT', true);
    if (value.code === 'ENOTFOUND' || value.code === 'EAI_AGAIN')
      return new LoginDependencyError('DNS_UNAVAILABLE', true);
    if (
      value.code === 'ECONNRESET' ||
      value.code === 'ECONNREFUSED' ||
      value.code === 'ENETUNREACH' ||
      value.code === 'EHOSTUNREACH' ||
      value.code === 'UND_ERR_SOCKET'
    )
      return new LoginDependencyError('CONNECTION_FAILED', true);
    current = value.cause;
  }
  return undefined;
}
