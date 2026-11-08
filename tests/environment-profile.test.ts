import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {networkProfileEnvironment} from '../server/environment-profile';
import {nearAuthConfiguration, nearNetworkConfiguration} from '../server/near-config';

const example = (network: string) => readFileSync(new URL(`../config/${network}.env.example`, import.meta.url), 'utf8');
describe('isolated network launch profiles', () => {
  it('uses the local testnet profile despite inherited mainnet credentials and endpoints', () => {
    const env = networkProfileEnvironment(example('testnet'), 'testnet', {
      PATH: 'system-tools',
      NEAR_NETWORK: 'mainnet',
      NEAR_RPC_URL: 'https://rpc.mainnet.near.org',
      NEAR_AUTH_CLIENT_ID: 'mainnet-client',
      DATABASE_URL: 'inherited-database-secret',
      NEAR_RELAYER_PRIVATE_KEY: 'inherited-key',
      ELEVENLABS_API_KEY: 'inherited-voice-secret',
      PUBLIC_URL: 'https://worldo.world',
      APP_ORIGIN: 'https://worldo.world',
      VITE_SECRET: 'must-not-be-inherited',
    });
    expect(env.PATH).toBe('system-tools');
    expect(env.DATABASE_URL).toBe('');
    expect(env.NEAR_RELAYER_PRIVATE_KEY).toBe('');
    expect(env.ELEVENLABS_API_KEY).toBe('');
    expect(env.APP_ORIGIN).toBeUndefined();
    expect(env.VITE_SECRET).toBeUndefined();
    expect(nearNetworkConfiguration(env)).toMatchObject({
      network: 'testnet',
      chainEnabled: true,
      intentsEnabled: false,
    });
    expect(nearAuthConfiguration(env)).toMatchObject({
      domain: 'login.testnet.fast-auth.com',
      appOrigin: 'http://localhost:3000',
    });
  });
  it('keeps an unconfigured mainnet deployment disabled without reusing testnet secrets', () => {
    const env = networkProfileEnvironment(example('mainnet'), 'mainnet', {
      NEAR_RELAYER_PRIVATE_KEY: 'testnet-secret',
      NEAR_AUTH_DOMAIN: 'login.testnet.fast-auth.com',
      NEAR_CONTRACT_ID: 'game.testnet',
      ENABLE_MAINNET: 'true',
      LOCAL_DATA_DIR: 'testnet-saves',
    });
    expect(env.NEAR_RELAYER_PRIVATE_KEY).toBe('');
    expect(env.NEAR_CONTRACT_ID).toBe('');
    expect(env.LOCAL_DATA_DIR).not.toBe('testnet-saves');
    expect(nearNetworkConfiguration(env)).toMatchObject({
      network: 'mainnet',
      chainEnabled: false,
      intentsEnabled: true,
    });
    expect(nearAuthConfiguration(env)).toMatchObject({
      clientId: null,
      domain: 'login.auth.near.org',
      appOrigin: 'https://worldo.world',
    });
  });
  it('takes credentials only from the selected file and preserves quoted values', () => {
    const text = example('testnet').replace('NEAR_AI_API_KEY=', 'NEAR_AI_API_KEY="profile#secret"');
    const env = networkProfileEnvironment(text, 'testnet', {
      near_ai_api_key: 'inherited-secret',
      NEAR_AI_API_KEY: 'other-secret',
    });
    expect(env.NEAR_AI_API_KEY).toBe('profile#secret');
    expect(env.near_ai_api_key).toBeUndefined();
  });
  it('rejects a wrong network file, opposite-network RPC and conflicting release flags', () => {
    expect(() => networkProfileEnvironment(example('testnet'), 'mainnet')).toThrow('match');
    expect(() =>
      networkProfileEnvironment(
        example('testnet').replace('NEAR_RPC_URL=', 'NEAR_RPC_URL=https://rpc.mainnet.near.org'),
        'testnet',
      ),
    ).toThrow('selected network');
    expect(() =>
      networkProfileEnvironment(example('testnet').replace('ENABLE_MAINNET=false', 'ENABLE_MAINNET=true'), 'testnet'),
    ).toThrow('ENABLE_MAINNET=false');
  });
  it('requires the normal social-login flow and explicit callback origin', () => {
    expect(() =>
      networkProfileEnvironment(
        example('testnet').replace('NEAR_AUTH_MODE=social', 'NEAR_AUTH_MODE=testnet-wallet'),
        'testnet',
      ),
    ).toThrow('NEAR_AUTH_MODE=social');
    expect(() =>
      networkProfileEnvironment(
        example('testnet').replace('PUBLIC_URL=http://localhost:3000', 'PUBLIC_URL='),
        'testnet',
      ),
    ).toThrow('PUBLIC_URL');
  });
});
