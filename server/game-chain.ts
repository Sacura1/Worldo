import {nearNetworkConfiguration,transactionExplorerUrl,assertNearRpcNetwork} from './near-config';
import {connect,keyStores,KeyPair} from 'near-api-js';
import {nearRpc,viewContract,nearConfiguration,executionSucceeded} from './near';
import type {Resource,PlaceId} from '../shared/types';
import {assertMainnetReady} from './production-readiness';

export interface LiveAccount {inventory:string[];balance:string;harvest_nonce:number;refinery:boolean;}
export interface ChainReceipt {hash:string;explorerUrl:string;outcome:Record<string,unknown>;}
const RESOURCE_ORDER:Resource[]=['crude','ore','timber','petrol','steel','planks'];
let oracleQueue=Promise.resolve();
export function merchantAccounts():Partial<Record<PlaceId,string>>{return{refinery:process.env.NEAR_REFINERY_ACCOUNT,foundry:process.env.NEAR_FOUNDRY_ACCOUNT,sawmill:process.env.NEAR_SAWMILL_ACCOUNT,depot:process.env.NEAR_DEPOT_ACCOUNT};}
export function gameChainConfigured(){return nearConfiguration().liveGameplayEnabled;}
export async function readLiveAccount(accountId:string):Promise<LiveAccount|null>{const contract=process.env.NEAR_CONTRACT_ID;if(!contract)throw new Error('Game contract is not configured.');return viewContract(contract,'account',{account_id:accountId});}
export async function readLiveEconomy(accountId:string){
 const contract=process.env.NEAR_CONTRACT_ID;if(!contract)throw new Error('Game contract is not configured.');
 const merchants=merchantAccounts();
 const [player,paused,merchantEntries]=await Promise.all([readLiveAccount(accountId),viewContract<boolean>(contract,'is_paused',{}),Promise.all(Object.entries(merchants).filter((entry):entry is [PlaceId,string]=>Boolean(entry[1])).map(async([place,id])=>({place,accountId:id,account:await readLiveAccount(id)})))]);
 return{player,paused,merchants:merchantEntries};
}
export async function liveTradeQuote(merchant:PlaceId,resource:Resource,quantity:number,buy:boolean):Promise<string>{
 const accountId=merchantAccounts()[merchant];if(!accountId)throw new Error('Merchant is not configured.');
 if(!Number.isInteger(quantity)||quantity<=0||quantity>100)throw new Error('Trade 1 to 100 units.');
 return viewContract(process.env.NEAR_CONTRACT_ID!,'quote',{merchant_id:accountId,token_id:resource,amount:String(quantity),buy});
}
export function inventoryFromChain(account:LiveAccount):Record<Resource,number>{
 if(account.inventory.length!==6)throw new Error('Unexpected contract inventory.');
 return Object.fromEntries(RESOURCE_ORDER.map((resource,i)=>{const count=BigInt(account.inventory[i]);if(count>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Inventory is too large for this game client.');return[resource,Number(count)];})) as Record<Resource,number>;
}
/**
 * Call only after the authoritative gameplay server has durably reserved this
 * account+nonce and validated gathering. A nonce is consumed on-chain exactly once.
 * On timeout, inspect harvest_nonce and the journal; never mint a new retry nonce.
 */
export async function submitHarvestGrant(accountId:string,resource:'crude'|'ore'|'timber',amount:number,nonce:number):Promise<ChainReceipt>{
 await assertMainnetReady();
 if(!gameChainConfigured())throw new Error('Chain gameplay is not configured.');
 if(!['crude','ore','timber'].includes(resource)||!Number.isInteger(amount)||amount<1||amount>10||!Number.isSafeInteger(nonce)||nonce<1)throw new Error('Invalid harvest grant.');
 return submitOracleCommand('grant_harvest',{account_id:accountId,token_id:resource,amount:String(amount),nonce});
}
export async function submitFuelConsumption(accountId:string,amount:number,nonce:number):Promise<ChainReceipt>{
 await assertMainnetReady();
 if(!gameChainConfigured())throw new Error('Chain gameplay is not configured.');
 if(!Number.isInteger(amount)||amount<1||amount>10||!Number.isSafeInteger(nonce)||nonce<1)throw new Error('Invalid fuel consumption.');
 return submitOracleCommand('consume_fuel',{account_id:accountId,amount:String(amount),nonce});
}
async function submitOracleCommand(method:'grant_harvest'|'consume_fuel',args:Record<string,unknown>):Promise<ChainReceipt>{
 const previous=oracleQueue;let release!:()=>void;oracleQueue=new Promise<void>(resolve=>{release=resolve;});await previous;
 try{
  await assertMainnetReady();
  await assertNearRpcNetwork();
  const keyStore=new keyStores.InMemoryKeyStore();await keyStore.setKey(nearNetworkConfiguration().network,process.env.NEAR_ORACLE_ACCOUNT_ID!,KeyPair.fromString(process.env.NEAR_ORACLE_PRIVATE_KEY as `ed25519:${string}`));
  const near=await connect({networkId:nearNetworkConfiguration().network,nodeUrl:nearNetworkConfiguration().rpcUrl,keyStore});const oracle=await near.account(process.env.NEAR_ORACLE_ACCOUNT_ID!);
  const outcome=await oracle.functionCall({contractId:process.env.NEAR_CONTRACT_ID!,methodName:method,args,gas:30_000_000_000_000n,attachedDeposit:0n});
  const final=await nearRpc<Record<string,unknown>>({tx_hash:outcome.transaction.hash,sender_account_id:process.env.NEAR_ORACLE_ACCOUNT_ID!,wait_until:'FINAL'},'tx');
  if(!executionSucceeded(final))throw new Error('The gameplay command did not finalize successfully.');
  return{hash:outcome.transaction.hash,explorerUrl:transactionExplorerUrl(outcome.transaction.hash),outcome:final};
 }finally{release();}
}
