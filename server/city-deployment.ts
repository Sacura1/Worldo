import {KeyPair} from '@near-js/crypto';
import {CITIES, CITY_IDS, STARTER_POOL} from '../shared/config/cities';
import {nearNetworkConfiguration, type Environment} from './near-config';

/** Public initialization data only. The private keys never enter this result. */
export function cityInitializationArguments(env: Environment = process.env) {
  const network = nearNetworkConfiguration(env).network;
  const account = (name: string) => {
    const value = env[name]?.trim();
    if (
      !value ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value) ||
      value.length < 2 ||
      value.length > 64 ||
      (!/^[a-f0-9]{64}$/.test(value) &&
        (network === 'testnet' ? !value.endsWith('.testnet') : value.endsWith('.testnet')))
    )
      throw new Error(`Configure a ${network} ${name}.`);
    return value;
  };
  const publicKey = (name: string) => {
    try {
      const pair = KeyPair.fromString(env[name] as `ed25519:${string}`);
      if (pair.getPublicKey().keyType !== 0) throw new Error();
      return pair.getPublicKey().toString();
    } catch {
      throw new Error(`Configure an Ed25519 ${name}.`);
    }
  };
  const owner = account('NEAR_CONTRACT_ID'),
    oracle = account('NEAR_ORACLE_ACCOUNT_ID');
  const cities = CITY_IDS.map(city => ({
    account_id: account(`NEAR_${city.toUpperCase()}_ACCOUNT`),
    public_key: publicKey(`NEAR_${city.toUpperCase()}_PRIVATE_KEY`),
    balances: {coin: CITIES[city].initialTreasury, ...CITIES[city].initialStock},
  }));
  if (new Set([owner, oracle, ...cities.map(city => city.account_id)]).size !== 5)
    throw new Error('Use distinct contract, oracle and three mayor accounts.');
  return {owner, oracle, oracle_key: publicKey('NEAR_ORACLE_PRIVATE_KEY'), network, cities, starter_pool: STARTER_POOL};
}
