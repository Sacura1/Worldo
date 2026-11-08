// Transaction approvals leave this tab for NEAR Auth and come back, so no popup
// opens. Ordinary social sign-in uses the server's OIDC flow; it must not request a
// transaction-signing token.
import {Auth0Client, type Cacheable} from '@auth0/auth0-spa-js';
export type NearAuthOptions = {clientId: string; domain: string; audience: string; guardId: string; appOrigin: string};
const APPROVAL_SCOPE = 'transaction:sign';
export class NearAuthProvider {
  private client: Auth0Client;
  // The library's token lookup drops anything within a minute of expiry, and an
  // approval token can live that briefly. Holding the cache here reads it directly.
  private tokens = new Map<string, Cacheable>();
  constructor(private options: NearAuthOptions) {
    if (globalThis.location && globalThis.location.origin !== options.appOrigin)
      throw new Error(`Open ${options.appOrigin} to sign in.`);
    this.client = new Auth0Client({
      domain: options.domain,
      clientId: options.clientId,
      authorizationParams: {redirect_uri: options.appOrigin},
      cache: {
        get: <T = Cacheable>(key: string) => this.tokens.get(key) as T | undefined,
        set: <T = Cacheable>(key: string, entry: T) => {
          this.tokens.set(key, entry as Cacheable);
        },
        remove: (key: string) => {
          this.tokens.delete(key);
        },
        allKeys: () => [...this.tokens.keys()],
      },
    });
  }
  async isLoggedIn() {
    return this.client.isAuthenticated();
  }
  async logout() {
    this.tokens.clear();
    await this.client.logout({logoutParams: {returnTo: this.options.appOrigin}});
  }
  private async user() {
    const claims = await this.client.getIdTokenClaims();
    if (!claims?.sub) throw new Error('Sign in first.');
    return {userId: claims.sub};
  }
  async getPath() {
    return `${this.options.guardId}#${(await this.user()).userId}`;
  }
  /** Sends this tab to the approval screen. `beforeLeaving` receives the state the
   * return will carry, so the page that loads afterwards can finish this approval. */
  async beginApproval(payload: number[], beforeLeaving: (state: string) => void) {
    if (!payload.length || payload.some(n => !Number.isInteger(n) || n < 0 || n > 255))
      throw new Error('Invalid authorization payload.');
    // Official NEAR Auth parameters are byte arrays. Auth0 serializes them as
    // comma-separated URL values.
    await this.client.loginWithRedirect({
      authorizationParams: {
        audience: this.options.audience,
        scope: APPROVAL_SCOPE,
        redirect_uri: this.options.appOrigin,
        delegateAction: payload,
      },
      openUrl: url => {
        const state = new URL(url).searchParams.get('state');
        if (!state) throw new Error('Invalid sign-in response.');
        beforeLeaving(state);
        window.location.assign(url);
      },
    });
  }
  private takeApprovalToken() {
    for (const [key, entry] of this.tokens)
      if (key.includes(APPROVAL_SCOPE) && 'body' in entry) {
        this.tokens.delete(key);
        return entry.body.access_token;
      }
  }
  /** Exchanges the returned code once and proves the token approves exactly `expected`. */
  async finishApproval(search: string, expected: number[]) {
    try {
      await this.client.handleRedirectCallback(`${this.options.appOrigin}/${search}`);
    } catch (error) {
      const code = error && typeof error === 'object' && 'error' in error ? error.error : undefined;
      if (code === 'access_denied') throw new Error('Authorization cancelled.');
      throw error;
    }
    const token = this.takeApprovalToken();
    if (!token) throw new Error('No authorization token returned.');
    const segment = token.split('.')[1];
    if (!segment) throw new Error('Invalid authentication response.');
    const encoded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')), c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes)) as {fatxn?: unknown; sub?: string};
    const actual = data.fatxn;
    if (!Array.isArray(actual) || actual.length !== expected.length || actual.some((n, i) => n !== expected[i]))
      throw new Error('Authorization does not match the current action. Please approve it again.');
    // Decoding only checks transport consistency; server and NEAR guard verify JWT.
    if (data.sub !== (await this.user()).userId) throw new Error('The authorization belongs to a different sign-in.');
    return token;
  }
}
