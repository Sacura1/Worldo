import {parseEnv} from 'node:util';
import {nearAuthConfiguration} from './near-config';

const applicationNames = new Set([
  'NODE_ENV',
  'PORT',
  'APP_MODE',
  'APP_ORIGIN',
  'PUBLIC_URL',
  'DATABASE_URL',
  'LOCAL_DATA_DIR',
  'TESTNET_SINGLE_PROCESS',
  'ENABLE_MAINNET',
  'ENABLE_TESTNET',
  'CHAIN_SYNC_ENABLED',
]);
const applicationSetting = (name: string) =>
  applicationNames.has(name.toUpperCase()) || /^(NEAR_|ELEVENLABS_|VITE_)/i.test(name);

/** Profiles are complete deployments. Do not inherit another deployment's
 * credentials, database, callback or RPC from the shell (or the generic .env). */
export function networkProfileEnvironment(
  contents: string,
  network: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!['testnet', 'mainnet'].includes(network)) throw new Error('Choose the testnet or mainnet profile.');
  const profile = parseEnv(contents);
  if (profile.NEAR_NETWORK !== network)
    throw new Error('The profile NEAR_NETWORK must match the selected launch command.');
  if (profile.APP_MODE !== 'production' || profile.NEAR_AUTH_MODE !== 'social')
    throw new Error('Network profiles require APP_MODE=production and NEAR_AUTH_MODE=social.');
  if (!profile.PUBLIC_URL) throw new Error('Set PUBLIC_URL in the selected profile.');
  const opposite = network === 'testnet' ? 'ENABLE_MAINNET' : 'ENABLE_TESTNET';
  if (profile[opposite] !== 'false') throw new Error(`Set ${opposite}=false in the selected profile.`);
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(inherited).filter(([name]) => !applicationSetting(name)),
  );
  Object.assign(env, profile, {NODE_ENV: 'production'});
  nearAuthConfiguration(env); // Validate network, RPC, callback and issuer together.
  return env;
}
