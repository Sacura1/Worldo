import {describe, it, expect} from 'vitest';
import {KeyPair} from '@near-js/crypto';
import {cityInitializationArguments} from '../server/city-deployment';
import {createWorld} from '../server/economy/index';
const setup = () => ({
  NEAR_NETWORK: 'testnet',
  NEAR_CONTRACT_ID: 'worldo.testnet',
  NEAR_ORACLE_ACCOUNT_ID: 'oracle.testnet',
  NEAR_ORACLE_PRIVATE_KEY: KeyPair.fromRandom('ed25519').toString(),
  ...Object.fromEntries(
    ['refinery', 'motor', 'harbor'].flatMap(city => [
      [`NEAR_${city.toUpperCase()}_ACCOUNT`, city + '.testnet'],
      [`NEAR_${city.toUpperCase()}_PRIVATE_KEY`, KeyPair.fromRandom('ed25519').toString()],
    ]),
  ),
});
describe('reproducible city contract initialization', () => {
  it('matches the authoritative world opening balances and finite supply exactly', () => {
    const env = setup(),
      args = cityInitializationArguments(env),
      world = createWorld({
        network: 'testnet',
        contractId: args.owner,
        cityAccounts: {
          refinery: args.cities[0].account_id,
          motor: args.cities[1].account_id,
          harbor: args.cities[2].account_id,
        },
        now: 1000,
      });
    expect(args.starter_pool).toBe(world.world.starterPool);
    for (const [index, city] of Object.values(world.world.cities).entries())
      expect(args.cities[index].balances).toEqual({coin: city.treasury, ...city.stock});
    expect(args.starter_pool + args.cities.reduce((sum, city) => sum + city.balances.coin, 0)).toBe(
      world.world.initialCoinSupply,
    );
  });
  it('exports public keys only and rejects cross-network or repeated accounts', () => {
    const env = setup(),
      args = cityInitializationArguments(env),
      json = JSON.stringify(args);
    for (const [key, value] of Object.entries(env)) if (key.endsWith('_PRIVATE_KEY')) expect(json).not.toContain(value);
    expect(() => cityInitializationArguments({...env, NEAR_NETWORK: 'mainnet'})).toThrow('mainnet');
    expect(() => cityInitializationArguments({...env, NEAR_MOTOR_ACCOUNT: env.NEAR_CONTRACT_ID})).toThrow('distinct');
  });
});
