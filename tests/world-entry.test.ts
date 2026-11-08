import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const calls = vi.hoisted(() => ({login: vi.fn(), authorize: vi.fn(), action: vi.fn()}));
vi.mock('../src/lib/near-auth', () => ({loginNear: calls.login, authorizeGameplaySession: calls.authorize}));
vi.mock('../src/lib/city-api', () => ({cityAction: calls.action}));
import {enterWorldo} from '../src/lib/world-entry';

const identity = {accountId: 'player.testnet', publicKey: 'ed25519:fixture', expiresAt: Date.now() + 60000};
let controller: AbortController;
const options = (identityKnown = false, authorized = false, localMode = false) => ({
  localMode,
  identity: identityKnown ? identity : null,
  authorized,
  signal: controller.signal,
  onIdentity: vi.fn(),
  onPermission: vi.fn(),
  onStage: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  controller = new AbortController();
  calls.authorize.mockResolvedValue({state: 'active'});
  calls.action.mockResolvedValue({player: {accountId: identity.accountId}});
  // Sign-in leaves the page, so the call never returns to this function.
  calls.login.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => vi.restoreAllMocks());

describe('disclosed Play onboarding', () => {
  it('leaves for sign-in first, with no approval or registration yet', async () => {
    const opts = options();
    void enterWorldo(opts);
    await vi.waitFor(() => expect(calls.login).toHaveBeenCalledExactlyOnceWith(controller.signal));
    expect(opts.onStage).toHaveBeenCalledExactlyOnceWith('signing-in');
    expect(calls.authorize).not.toHaveBeenCalled();
    expect(calls.action).not.toHaveBeenCalled();
  });
  it('finishes confirmed permission before the one registration on return', async () => {
    const opts = options(true, false),
      order: string[] = [];
    calls.authorize.mockImplementation(async () => {
      order.push('approved');
    });
    calls.action.mockImplementation(async () => {
      order.push('registered');
      return {player: {accountId: identity.accountId}};
    });
    const result = await enterWorldo(opts);
    expect(order).toEqual(['approved', 'registered']);
    expect(calls.action).toHaveBeenCalledExactlyOnceWith({type: 'register'});
    expect(opts.onPermission).toHaveBeenCalledOnce();
    expect(result.identity).toEqual(identity);
  });
  it('lets an existing permitted player enter without another login or approval', async () => {
    await enterWorldo(options(true, true));
    expect(calls.login).not.toHaveBeenCalled();
    expect(calls.authorize).not.toHaveBeenCalled();
    expect(calls.action).toHaveBeenCalledOnce();
  });
  it('continues account setup without repeating social login', async () => {
    await enterWorldo(options(true, false));
    expect(calls.login).not.toHaveBeenCalled();
    expect(calls.authorize).toHaveBeenCalledExactlyOnceWith({
      signal: controller.signal,
      expectedAccountId: identity.accountId,
    });
    expect(calls.action).toHaveBeenCalledOnce();
  });
  it('never registers when approval is declined or cannot be confirmed', async () => {
    calls.authorize.mockRejectedValue(new Error('Authorization cancelled.'));
    const opts = options(true, false);
    await expect(enterWorldo(opts)).rejects.toThrow('Authorization cancelled.');
    expect(calls.action).not.toHaveBeenCalled();
    expect(opts.onPermission).not.toHaveBeenCalled();
  });
  it('does not enter when cancellation arrives during a late approval', async () => {
    calls.authorize.mockImplementation(async () => {
      controller.abort();
    });
    const opts = options(true, false);
    await expect(enterWorldo(opts)).rejects.toThrow();
    expect(calls.action).not.toHaveBeenCalled();
    expect(opts.onPermission).not.toHaveBeenCalled();
  });
  it('does not authorize or register when already cancelled', async () => {
    controller.abort();
    await expect(enterWorldo(options())).rejects.toThrow();
    expect(calls.login).not.toHaveBeenCalled();
    expect(calls.authorize).not.toHaveBeenCalled();
    expect(calls.action).not.toHaveBeenCalled();
  });
  it('rejects a game response for another account', async () => {
    calls.action.mockResolvedValue({player: {accountId: 'another.testnet'}});
    await expect(enterWorldo(options(true, true))).rejects.toThrow('Could not verify');
  });
  it('keeps local play independent of social login and signing', async () => {
    calls.action.mockResolvedValue({player: {accountId: 'local-player'}});
    await enterWorldo(options(false, false, true));
    expect(calls.login).not.toHaveBeenCalled();
    expect(calls.authorize).not.toHaveBeenCalled();
    expect(calls.action).toHaveBeenCalledOnce();
  });
});
