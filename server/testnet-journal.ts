import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {nearNetworkConfiguration} from './near-config';

type Journal={day:number;reserved:string;wallets:Record<string,'preparing'|'ready'>};
let queue=Promise.resolve();
/** Test tokens only; durable single-process journal for the single-machine preview.
 * Mainnet continues to require Neon. Never stores a private key or login token. */
async function mutate<T>(update:(state:Journal)=>T):Promise<T>{
 if(!nearNetworkConfiguration().testnet)throw new Error('Local operator journals are only permitted on testnet.');
 const previous=queue;let unlock!:()=>void;queue=new Promise<void>(resolve=>{unlock=resolve;});await previous;
 try{
  const directory=process.env.LOCAL_DATA_DIR||path.resolve('.local/games');await mkdir(directory,{recursive:true});
  const file=path.join(directory,'testnet-operator.json');let state:Journal;
  try{state=JSON.parse(await readFile(file,'utf8')) as Journal;if(!/^\d+$/.test(state.reserved)||!state.wallets)throw new Error('Invalid testnet operator journal.');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={day:Math.floor(Date.now()/86400000),reserved:'0',wallets:{}};}
  const result=update(state),temporary=`${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(state),{mode:0o600});await rename(temporary,file);return result;
 }finally{unlock();}
}
export function reserveTestnetBudget(amount:bigint,budget:bigint){return mutate(state=>{
 const day=Math.floor(Date.now()/86400000);if(state.day!==day){state.day=day;state.reserved='0';}
 const next=BigInt(state.reserved)+amount;if(amount<=0n||next>budget)throw new Error('The testnet signing budget is exhausted for today.');state.reserved=next.toString();
});}
export function claimTestnetWallet(accountId:string){return mutate(state=>{if(state.wallets[accountId])return false;state.wallets[accountId]='preparing';return true;});}
export function finishTestnetWallet(accountId:string){return mutate(state=>{state.wallets[accountId]='ready';});}
export function releaseTestnetWallet(accountId:string){return mutate(state=>{if(state.wallets[accountId]==='preparing')delete state.wallets[accountId];});}
