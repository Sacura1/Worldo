import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {connect, keyStores, KeyPair, transactions} from 'near-api-js';
import {cityInitializationArguments} from '../server/city-deployment';
import {nearNetworkConfiguration} from '../server/near-config';

// No transaction is sent without --deploy. The default output is a public,
// reviewable initialization manifest, never a private key or connection string.
const flags = process.argv.slice(2),
  initialization = cityInitializationArguments(),
  network = nearNetworkConfiguration();
const value = (flag: string) => {
  const index = flags.indexOf(flag);
  return index >= 0 ? flags[index + 1] : undefined;
};
const wasmPath = resolve(value('--wasm') || 'contracts/target/wasm32-unknown-unknown/release/worldo_economy.wasm');
if (!flags.includes('--deploy')) {
  console.log(
    JSON.stringify({network: network.network, contractId: initialization.owner, wasmPath, initialization}, null, 2),
  );
} else {
  if (!network.chainEnabled) throw new Error(`Explicitly enable ${network.network} before deploying.`);
  if (network.network === 'mainnet' && !flags.includes('--confirm-mainnet'))
    throw new Error('Mainnet deployment requires --confirm-mainnet.');
  const keyFile = value('--key-file');
  if (!keyFile)
    throw new Error('Supply --key-file with the fresh contract account credentials. Keep that file outside Git.');
  let credentials: {account_id?: string; accountId?: string; private_key?: string; privateKey?: string};
  try {
    credentials = JSON.parse(await readFile(resolve(keyFile), 'utf8'));
  } catch {
    throw new Error('The deployment credential file could not be read.');
  }
  if ((credentials.account_id || credentials.accountId) !== initialization.owner)
    throw new Error('The deployment key file must belong to NEAR_CONTRACT_ID.');
  let pair: ReturnType<typeof KeyPair.fromString>;
  try {
    pair = KeyPair.fromString((credentials.private_key || credentials.privateKey) as `ed25519:${string}`);
  } catch {
    throw new Error('The deployment key is invalid.');
  }
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey(network.network, initialization.owner, pair);
  const near = await connect({networkId: network.network, nodeUrl: network.rpcUrl, keyStore}),
    provider = near.connection.provider;
  const status = await provider.status();
  if (status.chain_id !== network.network) throw new Error('RPC network does not match the selected profile.');
  const contract = await near.account(initialization.owner),
    wasm = await readFile(wasmPath),
    hash = bs58.encode(createHash('sha256').update(wasm).digest());
  if (wasm.length < 8 || wasm.subarray(0, 4).toString('hex') !== '0061736d')
    throw new Error('Build the Worldo WASM artifact first.');
  const access = await provider.query<{permission: unknown; block_height: number; block_hash: string}>({
    request_type: 'view_access_key',
    account_id: initialization.owner,
    public_key: pair.getPublicKey().toString(),
    finality: 'final',
  });
  if (access.permission !== 'FullAccess')
    throw new Error('A full-access deployment key for the fresh contract account is required.');
  const state = await provider.query<{values: unknown[]; block_height: number; block_hash: string}>({
    request_type: 'view_state',
    account_id: initialization.owner,
    prefix_base64: Buffer.from('STATE').toString('base64'),
    finality: 'final',
  });
  if (state.values.length)
    throw new Error(
      'The account already contains contract state. Use a fresh city-ledger account; this script does not migrate or overwrite it.',
    );
  const account = await provider.query<{code_hash: string; block_height: number; block_hash: string}>({
    request_type: 'view_account',
    account_id: initialization.owner,
    finality: 'final',
  });
  if (!/^1+$/.test(account.code_hash) && account.code_hash !== hash)
    throw new Error('The account contains different code. Use a fresh contract account.');
  // Check all signing accounts before any deployment mutation.
  for (const [accountId, publicKey] of [
    [initialization.oracle, initialization.oracle_key],
    ...initialization.cities.map(city => [city.account_id, city.public_key]),
  ]) {
    const signer = await provider.query<{permission: unknown; block_height: number; block_hash: string}>({
      request_type: 'view_access_key',
      account_id: accountId,
      public_key: publicKey,
      finality: 'final',
    });
    if (signer.permission !== 'FullAccess')
      throw new Error(`The configured operator key is not full access on ${accountId}.`);
  }
  const actions = [
    ...(account.code_hash !== hash ? [transactions.deployContract(wasm)] : []),
    transactions.functionCall('new', initialization, 100_000_000_000_000n, 0n),
  ];
  const result = await contract.signAndSendTransaction({receiverId: initialization.owner, actions});
  console.log(JSON.stringify({stage: 'deploy-and-initialize', transactionHash: result.transaction.hash}));
  const configuration = (await contract.viewFunction({
    contractId: initialization.owner,
    methodName: 'configuration',
    args: {},
  })) as {version: number; assetTransferMode: string; coinSupply: number};
  const expectedCoins =
    initialization.starter_pool + initialization.cities.reduce((sum, city) => sum + city.balances.coin, 0);
  if (
    configuration.version !== 2 ||
    configuration.assetTransferMode !== 'game-ledger' ||
    configuration.coinSupply !== expectedCoins
  )
    throw new Error('Deployment verification failed; do not enable chain sync.');
  console.log(
    JSON.stringify({
      stage: 'verified',
      network: network.network,
      contractId: initialization.owner,
      coinSupply: expectedCoins,
      assetTransferMode: configuration.assetTransferMode,
    }),
  );
}
