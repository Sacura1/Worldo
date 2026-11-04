import {reserveTestnetBudget,claimTestnetWallet,finishTestnetWallet,releaseTestnetWallet} from './testnet-journal';
import {connect,keyStores,KeyPair} from 'near-api-js';
import {neon} from '@neondatabase/serverless';
import {actionCreators,createTransaction,Signature,SignedTransaction,encodeTransaction,encodeDelegateAction,type DelegateAction,type Transaction} from '@near-js/transactions';
import {KeyPair as SigningKey} from '@near-js/crypto';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {nearAuthConfiguration,nearNetworkConfiguration,testnetWalletEnabled,assertNearRpcNetwork} from './near-config';
import {assertSponsoredDelegate} from './transaction-policy';
import {assertAccountReady,assertTransactionReady} from './production-readiness';

let lock=Promise.resolve();
let initialize:Promise<void>|undefined;
export function localRelayerConfigured(){return Boolean(process.env.NEAR_RELAYER_ACCOUNT_ID&&process.env.NEAR_RELAYER_PRIVATE_KEY?.startsWith('ed25519:')&&(testnetWalletEnabled()||process.env.NEAR_RELAYER_SIGN_DEPOSIT_YOCTO)&&process.env.NEAR_RELAYER_DAILY_BUDGET_YOCTO&&(process.env.DATABASE_URL||nearNetworkConfiguration().testnet));}
async function reserveBudget(reserved:bigint){
 const budget=BigInt(process.env.NEAR_RELAYER_DAILY_BUDGET_YOCTO||'0');
 if(reserved<=0n||reserved>budget)throw new Error('The operation exceeds the relayer budget.');
 if(nearNetworkConfiguration().testnet){await reserveTestnetBudget(reserved,budget);return;}
 const sql=neon(process.env.DATABASE_URL!);
 initialize??=sql`CREATE TABLE IF NOT EXISTS lowland_relayer_budget (day date PRIMARY KEY, reserved numeric(40,0) NOT NULL)`.then(()=>undefined).catch(error=>{initialize=undefined;throw error;});await initialize;
 const rows=await sql`INSERT INTO lowland_relayer_budget(day,reserved) VALUES(CURRENT_DATE,${reserved.toString()}::numeric) ON CONFLICT(day) DO UPDATE SET reserved=lowland_relayer_budget.reserved+EXCLUDED.reserved WHERE lowland_relayer_budget.reserved+EXCLUDED.reserved<=${budget.toString()}::numeric RETURNING reserved`;
 if(!rows.length)throw new Error('The signing budget is exhausted for today.');
}
async function gasReservation(gas:bigint){
 const response=await fetch(nearNetworkConfiguration().rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'sponsor-gas',method:'gas_price',params:{block_id:null}}),signal:AbortSignal.timeout(15000)});
 const body=await response.json() as {result?:{gas_price:string};error?:unknown};
 if(!response.ok||body.error||!body.result?.gas_price||!/^\d+$/.test(body.result.gas_price))throw new Error('The sponsor gas allowance is unavailable.');
 // Reserve twice the current price plus receipt overhead. This is a budget
 // reservation, not a promise that future protocol gas prices are fixed.
 return (gas+5_000_000_000_000n)*BigInt(body.result.gas_price)*2n;
}
function mpcSignature(signaturePayload:string):Uint8Array{
 const payload=JSON.parse(Buffer.from(signaturePayload,'base64').toString()) as {signature?:number[]};
 if(!Array.isArray(payload.signature)||payload.signature.length!==64||payload.signature.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error('Invalid MPC signature.');
 return Uint8Array.from(payload.signature);
}
export function assembleUserSignedTransaction(transaction:Transaction,signaturePayload:string){
 const signature=mpcSignature(signaturePayload);
 if(!transaction.publicKey.verify(createHash('sha256').update(encodeTransaction(transaction)).digest(),signature))throw new Error('The signature does not match the player transaction.');
 return new SignedTransaction({transaction,signature:new Signature({keyType:0,data:signature})});
}
/** Classify the actual signed receiver and method, not an API-provided label. */
function readinessMethod(transaction:{receiverId:string;actions:{enum?:string;functionCall?:{methodName:string}}[]}):string{
 const call=transaction.actions.length===1&&transaction.actions[0].enum==='functionCall'?transaction.actions[0].functionCall:undefined;
 if(call&&transaction.receiverId===process.env.NEAR_CONTRACT_ID&&['register','deposit','withdraw'].includes(call.methodName))return call.methodName;
 if(call&&transaction.receiverId===nearNetworkConfiguration().wrappedToken&&call.methodName==='near_withdraw')return 'unwrap';
 return 'gameplay';
}
/** Only the player's signature authorizes this ordinary transaction. The
 * protocol charges its signer (the player) the deposit and network gas. */
export async function submitUserTransaction(transaction:Transaction,signaturePayload:string):Promise<Record<string,unknown>>{
 await assertTransactionReady(readinessMethod(transaction));
 const signed=assembleUserSignedTransaction(transaction,signaturePayload);
 await assertNearRpcNetwork();
 const response=await fetch(nearNetworkConfiguration().rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'player-transaction',method:'send_tx',params:{signed_tx_base64:Buffer.from(encodeTransaction(signed)).toString('base64'),wait_until:'FINAL'}}),signal:AbortSignal.timeout(60000)});
 const body=await response.json() as {result?:Record<string,unknown>;error?:unknown};
 if(!response.ok||body.error||!body.result)throw new Error('The player transaction could not be confirmed.');
 return body.result;
}
/** Caller must already verify identity, exact transaction bytes and method policy. */
export async function relayAuthorizedSignature(token:string,bytes:number[],method='gameplay'):Promise<string>{
 await assertTransactionReady(method);
 const previous=lock;let unlock!:()=>void;lock=new Promise<void>(resolve=>{unlock=resolve;});await previous;
 try{
  if(!localRelayerConfigured())throw new Error('The signing relayer is not configured.');
  await assertNearRpcNetwork();
  const deposit=BigInt(process.env.NEAR_RELAYER_SIGN_DEPOSIT_YOCTO!);
  if(deposit<0n)throw new Error('The relayer has no signing budget.');
  // Reserve the signing service's deposit and gas separately from the user's
  // eventual game deposit. Reservation survives restart and is not refunded.
  const reserved=deposit+await gasReservation(300_000_000_000_000n);
  await reserveBudget(reserved);
  const keyStore=new keyStores.InMemoryKeyStore();
  const key=KeyPair.fromString(process.env.NEAR_RELAYER_PRIVATE_KEY as `ed25519:${string}`);
  await keyStore.setKey(nearNetworkConfiguration().network,process.env.NEAR_RELAYER_ACCOUNT_ID!,key);
  const near=await connect({networkId:nearNetworkConfiguration().network,nodeUrl:nearNetworkConfiguration().rpcUrl,keyStore});
  const account=await near.account(process.env.NEAR_RELAYER_ACCOUNT_ID!);
  const result=await account.functionCall({contractId:nearNetworkConfiguration().authContract,methodName:'sign',args:{guard_id:nearAuthConfiguration().guardId,verify_payload:token,sign_payload:bytes,algorithm:'eddsa'},gas:300_000_000_000_000n,attachedDeposit:deposit});
  const confirmation=await fetch(nearNetworkConfiguration().rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'sign-final',method:'tx',params:{tx_hash:result.transaction.hash,sender_account_id:process.env.NEAR_RELAYER_ACCOUNT_ID,wait_until:'FINAL'}}),signal:AbortSignal.timeout(60000)});
  const final=await confirmation.json() as {result?:{status?:{SuccessValue?:string}};error?:unknown};
  if(!confirmation.ok||final.error||!final.result?.status?.SuccessValue)throw new Error('The NEAR Auth contract did not return a finalized signature.');
  return final.result.status.SuccessValue;
 }finally{unlock();}
}
/** One sponsored implicit account + wNEAR storage registration per verified identity. */
export async function provisionNearWallet(accountId:string){
 await assertAccountReady();
 if(!localRelayerConfigured()||!/^[a-f0-9]{64}$/.test(accountId))throw new Error('Wallet preparation is not available.');
 const previous=lock;let unlock!:()=>void;lock=new Promise<void>(resolve=>{unlock=resolve;});await previous;
 let claimed=false,broadcastStarted=false;
 try{
  await assertNearRpcNetwork();
  const testnet=nearNetworkConfiguration().testnet,sql=testnet?null:neon(process.env.DATABASE_URL!);
  if(sql)await sql`CREATE TABLE IF NOT EXISTS lowland_wallet_setup (account_id text PRIMARY KEY,state text NOT NULL,created_at timestamptz NOT NULL DEFAULT now())`;
  const rpc=async(method:string,params:unknown)=>{
   const response=await fetch(nearNetworkConfiguration().rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'wallet-setup',method,params}),signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw new Error('NEAR is temporarily unavailable.');return response.json() as Promise<{result?:Record<string,unknown>;error?:unknown}>;
  };
  const status=await rpc('query',{request_type:'view_account',finality:'final',account_id:accountId});
  if(status.error&&!JSON.stringify(status.error).includes('UNKNOWN_ACCOUNT'))throw new Error('Account status could not be verified.');
  const exists=Boolean(status.result);
  const keyStore=new keyStores.InMemoryKeyStore();await keyStore.setKey(nearNetworkConfiguration().network,process.env.NEAR_RELAYER_ACCOUNT_ID!,KeyPair.fromString(process.env.NEAR_RELAYER_PRIVATE_KEY as `ed25519:${string}`));
  const near=await connect({networkId:nearNetworkConfiguration().network,nodeUrl:nearNetworkConfiguration().rpcUrl,keyStore});const sponsor=await near.account(process.env.NEAR_RELAYER_ACCOUNT_ID!);
  const storage=await sponsor.viewFunction({contractId:nearNetworkConfiguration().wrappedToken,methodName:'storage_balance_of',args:{account_id:accountId}});
  if(exists&&storage)return{accountId,ready:true,hashes:[] as string[]};
  const inserted=testnet?await claimTestnetWallet(accountId):Boolean((await sql!`INSERT INTO lowland_wallet_setup(account_id,state) VALUES(${accountId},'preparing') ON CONFLICT(account_id) DO NOTHING RETURNING account_id`).length);
  if(!inserted)throw new Error('Wallet preparation needs confirmation. Check its status before retrying.');
  claimed=true;
  const bounds=await sponsor.viewFunction({contractId:nearNetworkConfiguration().wrappedToken,methodName:'storage_balance_bounds',args:{}}) as {min:string};
  const storageCost=storage?0n:BigInt(bounds.min),accountCost=exists?0n:testnet?1_000_000_000_000_000_000_000_000n:10_000_000_000_000_000_000_000n;
  if(storageCost>10_000_000_000_000_000_000_000n)throw new Error('Unexpected wNEAR storage requirement.');
  await reserveBudget(storageCost+accountCost+30_000_000_000_000_000_000_000n);
  const hashes:string[]=[];
  const confirm=async(result:{transaction:{hash:string}})=>{const final=await rpc('tx',{tx_hash:result.transaction.hash,sender_account_id:process.env.NEAR_RELAYER_ACCOUNT_ID,wait_until:'FINAL'});if(final.error||!final.result?.status||typeof final.result.status!=='object'||!('SuccessValue'in final.result.status))throw new Error('Wallet setup is awaiting confirmation.');hashes.push(result.transaction.hash);};
  if(!exists){broadcastStarted=true;await confirm(await sponsor.sendMoney(accountId,accountCost));}
  if(!storage){broadcastStarted=true;await confirm(await sponsor.functionCall({contractId:nearNetworkConfiguration().wrappedToken,methodName:'storage_deposit',args:{account_id:accountId,registration_only:true},gas:30_000_000_000_000n,attachedDeposit:storageCost}));}
  if(testnet)await finishTestnetWallet(accountId);else await sql!`UPDATE lowland_wallet_setup SET state='ready' WHERE account_id=${accountId}`;
  return{accountId,ready:true,hashes};
 }catch(error){
  if(claimed&&!broadcastStarted){if(nearNetworkConfiguration().testnet)await releaseTestnetWallet(accountId);else{const sql=neon(process.env.DATABASE_URL!);await sql`DELETE FROM lowland_wallet_setup WHERE account_id=${accountId} AND state='preparing'`;}}
  throw error;
 }finally{unlock();}
}
/** Wrap the user's signed delegate action in the sponsor's transaction (NEP-366). */
export async function submitSponsoredDelegate(delegate:DelegateAction,signaturePayload:string):Promise<Record<string,unknown>>{
 const attached=assertSponsoredDelegate(delegate);
 await assertTransactionReady(readinessMethod(delegate));
 const previous=lock;let unlock!:()=>void;lock=new Promise<void>(resolve=>{unlock=resolve;});await previous;
 try{
  if(!localRelayerConfigured())throw new Error('The signing relayer is not configured.');
  await assertNearRpcNetwork();
  const signature=mpcSignature(signaturePayload);
  if(!delegate.publicKey.verify(createHash('sha256').update(encodeDelegateAction(delegate)).digest(),signature))throw new Error('The signature does not match the approved delegate.');
  await reserveBudget(attached+await gasReservation(delegate.actions[0].functionCall!.gas));
  const pair=SigningKey.fromString(process.env.NEAR_RELAYER_PRIVATE_KEY as `ed25519:${string}`);
  const rpc=async(method:string,params:unknown)=>{
   const response=await fetch(nearNetworkConfiguration().rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'lowland-relay',method,params}),signal:AbortSignal.timeout(60000)});
   const body=await response.json() as {result?:Record<string,unknown>;error?:unknown};if(!response.ok||body.error||!body.result)throw new Error('The sponsored transaction could not be confirmed.');return body.result;
  };
  const access=await rpc('query',{request_type:'view_access_key',finality:'final',account_id:process.env.NEAR_RELAYER_ACCOUNT_ID,public_key:pair.getPublicKey().toString()});
  const action=actionCreators.signedDelegate({delegateAction:delegate,signature:new Signature({keyType:0,data:signature})});
  // The wrapper receiver is the original sender. The signed delegate itself
  // names the game contract. The sponsor pays its one-yocto deposit AND gas.
  const transaction=createTransaction(process.env.NEAR_RELAYER_ACCOUNT_ID!,pair.getPublicKey(),delegate.senderId,BigInt(access.nonce as number)+1n,[action],bs58.decode(access.block_hash as string));
  const signed=pair.sign(createHash('sha256').update(encodeTransaction(transaction)).digest());
  const envelope=new SignedTransaction({transaction,signature:new Signature({keyType:0,data:signed.signature})});
  return rpc('send_tx',{signed_tx_base64:Buffer.from(encodeTransaction(envelope)).toString('base64'),wait_until:'FINAL'});
 }finally{unlock();}
}
