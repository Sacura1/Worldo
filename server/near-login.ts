import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey} from 'jose';
import {nearAuthConfiguration, NEAR_AUTH_CLOCK_TOLERANCE_SECONDS} from './near-config';
import {GameError} from './errors';
import {LoginDependencyError, loginDependencyFailure} from './login-dependency';

type AuthConfig = ReturnType<typeof nearAuthConfiguration>;
type LoginStatus = 'pending' | 'verifying' | 'complete' | 'failed';
type Attempt = {
  id: string;
  state: string;
  session: string;
  nonce: string;
  verifier: string;
  config: AuthConfig;
  expiresAt: number;
  status: LoginStatus;
  error?: string;
};
type Completion = {state?: unknown; code?: unknown; error?: unknown};
export type LoginDiagnostic = {
  stage: 'token_exchange' | 'token_verification' | 'identity_lookup';
  code: string;
  readAttempt: 1 | 2;
  retrying: boolean;
  durationMs: number;
  httpStatus?: number;
  claim?: string;
};
type Options<Identity> = {
  config: () => AuthConfig;
  enabled: () => boolean;
  deriveIdentity: (subject: string, config: AuthConfig) => Promise<Identity>;
  saveIdentity: (session: string, identity: Identity) => void;
  request?: typeof fetch;
  keys?: (issuer: string) => JWTVerifyGetKey;
  now?: () => number;
  diagnostic?: (event: LoginDiagnostic) => void;
  delay?: (ms: number) => Promise<void>;
};
const expired = 'Sign-in expired. Please sign in again.';
const unavailable = 'NEAR sign-in is temporarily unavailable. Please try again.';
const invalid = 'Could not verify your NEAR sign-in. Please try again.';
const cancelled = 'Sign-in was cancelled.';
const random = () => randomBytes(32).toString('base64url');
// A refusal is rechecked soon, so an approval takes effect within a minute.
const ORIGIN_REFUSED_FOR_MS = 60_000;
const ORIGIN_ACCEPTED_FOR_MS = 10 * 60_000;
const equal = (a: string, b: string) => {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
const diagnosticCodes = new Set([
  'ERR_JOSE_GENERIC',
  'ERR_JWS_INVALID',
  'ERR_JWT_INVALID',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JWKS_INVALID',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ID_TOKEN_MISSING',
  'IDENTITY_BINDING',
]);
const diagnosticClaims = new Set(['iss', 'aud', 'iat', 'exp', 'nbf', 'sub', 'nonce']);
class LoginValidationError extends Error {
  constructor(readonly code: 'ID_TOKEN_MISSING' | 'IDENTITY_BINDING') {
    super('Invalid sign-in identity.');
  }
}

/** Initial sign-in is OIDC, not a signing request. Older NEAR Auth deployments
 * support transaction approvals but reject the newer NEP-413 signing parameter.
 * Provider tokens stay in the server-side exchange and never enter the game client.
 */
export class NearLogin<Identity> {
  private attempts = new Map<string, Attempt>();
  private states = new Map<string, string>();
  private active = new Map<string, string>();
  private keySets = new Map<string, JWTVerifyGetKey>();
  private originCheck?: {key: string; accepted: boolean; expiresAt: number};
  private now: () => number;
  constructor(private options: Options<Identity>) {
    this.now = options.now ?? Date.now;
  }
  private keys(issuer: string) {
    if (this.options.keys) return this.options.keys(issuer);
    let keys = this.keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL('.well-known/jwks.json', issuer), {
        timeoutDuration: 5000,
        [customFetch]: async (url, init) => {
          const response = await fetch(url, init);
          if (response.status !== 200)
            throw new LoginDependencyError(
              'JWKS_HTTP',
              response.status === 429 || response.status >= 500,
              response.status,
            );
          return response;
        },
      });
      this.keySets.set(issuer, keys);
    }
    return keys;
  }
  private report(
    stage: LoginDiagnostic['stage'],
    error: unknown,
    readAttempt: 1 | 2,
    retrying: boolean,
    startedAt: number,
    httpStatus?: number,
  ) {
    const dependency = loginDependencyFailure(error),
      details = error && typeof error === 'object' ? (error as {code?: unknown; claim?: unknown}) : {};
    const code =
      dependency?.code ??
      (typeof details.code === 'string' && diagnosticCodes.has(details.code) ? details.code : 'UNCLASSIFIED');
    const claim = typeof details.claim === 'string' && diagnosticClaims.has(details.claim) ? details.claim : undefined;
    const status = dependency?.httpStatus ?? httpStatus;
    const event: LoginDiagnostic = {
      stage,
      code,
      readAttempt,
      retrying,
      durationMs: Math.max(0, this.now() - startedAt),
      ...(status !== undefined ? {httpStatus: status} : {}),
      ...(claim ? {claim} : {}),
    };
    try {
      if (this.options.diagnostic) this.options.diagnostic(event);
      else console.warn('[worldo:near-login]', event);
    } catch {
      /* Diagnostics must not affect authentication. */
    }
  }
  private async read<T>(
    attempt: Attempt,
    stage: 'token_verification' | 'identity_lookup',
    operation: () => Promise<T>,
  ): Promise<T> {
    for (const number of [1, 2] as const) {
      if (!this.current(attempt)) throw this.inactive(attempt);
      const startedAt = this.now();
      try {
        return await operation();
      } catch (error) {
        if (!this.current(attempt)) throw this.inactive(attempt);
        const retrying = number === 1 && loginDependencyFailure(error)?.retryable === true;
        this.report(stage, error, number, retrying, startedAt);
        if (!retrying) throw error;
        await (this.options.delay?.(250) ?? new Promise<void>(resolve => setTimeout(resolve, 250)));
      }
    }
    throw new Error('Unreachable sign-in read state.');
  }
  private clean() {
    for (const [id, attempt] of this.attempts)
      if (attempt.expiresAt <= this.now()) {
        this.attempts.delete(id);
        this.states.delete(attempt.state);
        if (this.active.get(attempt.session) === id) this.active.delete(attempt.session);
      }
  }
  private fail(attempt: Attempt, message: string) {
    attempt.status = 'failed';
    attempt.error = message;
    attempt.verifier = '';
    attempt.nonce = '';
    this.states.delete(attempt.state);
    if (this.active.get(attempt.session) === attempt.id) this.active.delete(attempt.session);
  }
  private current(attempt: Attempt) {
    if (
      this.active.get(attempt.session) !== attempt.id ||
      attempt.status !== 'verifying' ||
      attempt.expiresAt <= this.now()
    )
      return false;
    try {
      return this.options.enabled() && JSON.stringify(attempt.config) === JSON.stringify(this.options.config());
    } catch {
      return false;
    }
  }
  private inactive(attempt: Attempt) {
    if (this.active.get(attempt.session) === attempt.id) this.fail(attempt, expired);
    return new GameError(expired, 401);
  }
  private authorizationUrl(config: AuthConfig, state: string, nonce: string, verifier: string) {
    const url = new URL('authorize', config.issuer);
    url.search = new URLSearchParams({
      client_id: config.clientId!,
      response_type: 'code',
      response_mode: 'query',
      redirect_uri: config.appOrigin,
      scope: 'openid',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return url;
  }
  /** NEAR Auth answers an address it has not allowed with its own dead-end error page,
   * where the game can no longer help the player. So the game asks first, with a throwaway
   * request. Only that exact refusal counts: anything else, including an outage, leaves the
   * ordinary sign-in open. Once the address is approved this passes with no change here. */
  async originAccepted() {
    const config = this.options.config();
    if (!this.options.enabled() || !config.clientId) return true;
    const key = `${config.issuer}|${config.clientId}|${config.appOrigin}`,
      known = this.originCheck;
    if (known?.key === key && known.expiresAt > this.now()) return known.accepted;
    try {
      const response = await (this.options.request ?? fetch)(
        this.authorizationUrl(config, random(), random(), random()),
        {redirect: 'manual', signal: AbortSignal.timeout(8000)},
      );
      const redirected = response.status >= 300 && response.status < 400,
        refused = response.status === 403 && /callback url mismatch/i.test(await response.text());
      if (redirected || refused)
        this.originCheck = {
          key,
          accepted: redirected,
          expiresAt: this.now() + (redirected ? ORIGIN_ACCEPTED_FOR_MS : ORIGIN_REFUSED_FOR_MS),
        };
      return !refused;
    } catch {
      return true;
    }
  }
  start(session: string) {
    if (!this.options.enabled()) throw new GameError('NEAR Auth credentials are not configured.', 503);
    this.clean();
    if (this.attempts.size >= 10000) throw new GameError('Try signing in again shortly.', 429);
    this.cancelSession(session);
    const config = this.options.config();
    if (!config.clientId) throw new GameError('NEAR Auth credentials are not configured.', 503);
    const attempt: Attempt = {
      id: random(),
      state: random(),
      session,
      nonce: random(),
      verifier: random(),
      config,
      expiresAt: this.now() + 5 * 60_000,
      status: 'pending',
    };
    this.attempts.set(attempt.id, attempt);
    this.states.set(attempt.state, attempt.id);
    this.active.set(session, attempt.id);
    const authorizationUrl = this.authorizationUrl(config, attempt.state, attempt.nonce, attempt.verifier);
    return {authorizationUrl: authorizationUrl.toString(), attemptId: attempt.id, expiresAt: attempt.expiresAt};
  }
  status(session: string, id: unknown) {
    this.clean();
    const attempt = typeof id === 'string' ? this.attempts.get(id) : undefined;
    if (!attempt || attempt.session !== session) throw new GameError(expired, 401);
    return {status: attempt.status, ...(attempt.error ? {error: attempt.error} : {})};
  }
  cancelSession(session: string) {
    const id = this.active.get(session),
      attempt = id ? this.attempts.get(id) : undefined;
    if (attempt) this.fail(attempt, cancelled);
  }
  cancel(session: string, id: unknown) {
    this.clean();
    const attempt = typeof id === 'string' ? this.attempts.get(id) : undefined;
    if (!attempt || attempt.session !== session) throw new GameError(expired, 401);
    if (attempt.status === 'pending' || attempt.status === 'verifying') this.fail(attempt, cancelled);
  }
  async complete(session: string, input: Completion) {
    this.clean();
    const id = typeof input.state === 'string' ? this.states.get(input.state) : undefined,
      attempt = id ? this.attempts.get(id) : undefined;
    // A forged session must not consume the legitimate browser's pending attempt.
    if (
      !attempt ||
      attempt.session !== session ||
      attempt.status !== 'pending' ||
      this.active.get(session) !== attempt.id
    )
      throw new GameError(expired, 401);
    this.states.delete(attempt.state);
    attempt.status = 'verifying';
    if (typeof input.error === 'string' && input.error && !input.code) {
      this.fail(
        attempt,
        input.error === 'access_denied' ? cancelled : 'NEAR sign-in could not be completed. Please try again.',
      );
      throw new GameError(attempt.error!, 401);
    }
    if (typeof input.code !== 'string' || !input.code || input.code.length > 4096 || input.error !== undefined) {
      this.fail(attempt, invalid);
      throw new GameError(invalid, 400);
    }
    const {config, nonce, verifier} = attempt;
    // Consume the code/PKCE material once; a retry creates a fresh authorization.
    attempt.verifier = '';
    attempt.nonce = '';
    let token: unknown, exchangeStatus: number | undefined;
    const exchangeStartedAt = this.now();
    try {
      const response = await (this.options.request ?? fetch)(new URL('oauth/token', config.issuer), {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        redirect: 'error',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId!,
          code: input.code,
          code_verifier: verifier,
          redirect_uri: config.appOrigin,
        }),
        signal: AbortSignal.timeout(20000),
      });
      exchangeStatus = response.status;
      if (!response.ok) throw new Error('Provider exchange failed.');
      const body = (await response.json()) as {id_token?: unknown};
      token = body.id_token;
    } catch (error) {
      if (!this.current(attempt)) throw this.inactive(attempt);
      this.report('token_exchange', error, 1, false, exchangeStartedAt, exchangeStatus);
      this.fail(attempt, unavailable);
      throw new GameError(unavailable, 503);
    }
    let subject: string;
    try {
      subject = await this.read(attempt, 'token_verification', async () => {
        if (typeof token !== 'string' || token.length > 20000) throw new LoginValidationError('ID_TOKEN_MISSING');
        // The provider and this machine may differ by a few seconds. Keep a small,
        // fixed tolerance; long-lived/stale tokens still fail the five-minute limit.
        const {payload} = await jwtVerify(token, this.keys(config.issuer), {
          issuer: config.issuer,
          audience: config.clientId!,
          algorithms: ['RS256'],
          requiredClaims: ['sub', 'iat', 'exp', 'nonce'],
          maxTokenAge: '5m',
          clockTolerance: NEAR_AUTH_CLOCK_TOLERANCE_SECONDS,
          currentDate: new Date(this.now()),
        });
        if (
          typeof payload.sub !== 'string' ||
          !payload.sub ||
          typeof payload.nonce !== 'string' ||
          !equal(payload.nonce, nonce) ||
          (payload.azp !== undefined && payload.azp !== config.clientId) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId)
        )
          throw new LoginValidationError('IDENTITY_BINDING');
        return payload.sub;
      });
    } catch (error) {
      if (!this.current(attempt)) throw this.inactive(attempt);
      const message = loginDependencyFailure(error) ? unavailable : invalid;
      this.fail(attempt, message);
      throw new GameError(message, message === unavailable ? 503 : 401);
    }
    try {
      const identity = await this.read(attempt, 'identity_lookup', () => this.options.deriveIdentity(subject, config));
      // Logout, expiry, or another login can race the token exchange or MPC read.
      if (!this.current(attempt)) throw new Error('Attempt no longer active.');
      this.options.saveIdentity(session, identity);
      attempt.status = 'complete';
      this.active.delete(session);
      return {ok: true as const};
    } catch {
      if (!this.current(attempt)) throw this.inactive(attempt);
      this.fail(attempt, unavailable);
      throw new GameError(unavailable, 503);
    }
  }
}
