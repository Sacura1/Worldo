import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {neon} from '@neondatabase/serverless';
import {KeyPair} from '@near-js/crypto';
import {appMode,nearAuthConfiguration,nearNetworkConfiguration,type Environment} from './near-config';

export type ReadinessCheck={id:string;label:string;status:'ready'|'missing'|'unverified';detail:string};
export type ProductionReadiness={ready:boolean;accountReady:boolean;checkedAt:number|null;checks:ReadinessCheck[]};
const accountChecks=['network','origin','social','database','contract','relayer','release','auth-service','storage','chain'];
const merchantKeys=['NEAR_REFINERY_ACCOUNT','NEAR_FOUNDRY_ACCOUNT','NEAR_SAWMILL_ACCOUNT','NEAR_DEPOT_ACCOUNT'] as const;
const networkAccount=(value:string|undefined,testnet:boolean)=>Boolean(value&&value.length>=2&&value.length<=64&&/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value)&&(/^[a-f0-9]{64}$/.test(value)||(testnet?value.endsWith('.testnet'):!value.endsWith('.testnet'))));
const positive=(value:string|undefined)=>Boolean(value&&/^\d{1,31}$/.test(value)&&BigInt(value)>0n);
const secretKey=(value:string|undefined)=>{try{return Boolean(value?.startsWith('ed25519:')&&KeyPair.fromString(value as `ed25519:${string}`).getPublicKey().keyType===0);}catch{return false;}};
export function validProductionDatabase(value:string|undefined){
 try{const url=new URL(value||'');return ['postgres:','postgresql:'].includes(url.protocol)&&url.hostname.endsWith('.neon.tech')&&url.hostname.includes('-pooler.')&&Boolean(url.username&&url.password&&url.pathname.length>1)&&['require','verify-full'].includes(url.searchParams.get('sslmode')||'');}catch{return false;}
}
function configurationChecks(env:Environment):ReadinessCheck[]{
 const checks:ReadinessCheck[]=[];
 const add=(id:string,label:string,ok:boolean,detail:string)=>checks.push({id,label,status:ok?'ready':'missing',detail});
 let chain:ReturnType<typeof nearNetworkConfiguration>|undefined,auth:ReturnType<typeof nearAuthConfiguration>|undefined;
 try{chain=nearNetworkConfiguration(env);}catch{/* Expose configuration names, never values or credentials. */}
 try{auth=nearAuthConfiguration(env);}catch{/* The callback/issuer must be valid before any provider call. */}
 const testnet=Boolean(chain?.testnet),network=testnet?'testnet':'mainnet',account=(value:string|undefined)=>networkAccount(value,testnet);
 add('network',`NEAR ${network}`,Boolean(chain),'Select an explicit NEAR network and a matching HTTPS RPC.');
 add('origin','Application origin',Boolean(auth&&(auth.appOrigin.startsWith('https://')||testnet&&['localhost','127.0.0.1','[::1]'].includes(new URL(auth.appOrigin).hostname))),'Use the exact allowed callback origin. Loopback HTTP is supported for testnet only.');
 const mainnetAuth=Boolean(auth?.clientId&&![ 'np8paqIpMWmNbzT4xAvOOapZBjsOpptl','dsurLc47fOcWme5PkYeClBvuW0tYrmgW'].includes(auth.clientId)&&!auth.domain.includes('testnet')&&!auth.audience.includes('testnet')&&!auth.guardId.includes('testnet'));
 add('social','Social sign-in',Boolean(auth?.clientId&&(env.NEAR_AUTH_MODE||'social')==='social'&&(testnet||mainnetAuth)),testnet?'The shared testnet client needs no mainnet approval, but its callback must allow this origin.':'Use this app’s approved mainnet NEAR Auth credentials. Shared example clients are not production credentials.');
 const local=testnet&&!env.DATABASE_URL;
 add('database',local?'Testnet storage':'Neon connection',local?Boolean(env.LOCAL_DATA_DIR?.trim()&&env.TESTNET_SINGLE_PROCESS==='true'):validProductionDatabase(env.DATABASE_URL),local?'Set LOCAL_DATA_DIR to durable storage and TESTNET_SINGLE_PROCESS=true; run one app machine.':'DATABASE_URL must be the pooled Neon connection string with TLS enabled.');
 add('contract','Game contract',account(env.NEAR_CONTRACT_ID),`Set the deployed ${network} NEAR_CONTRACT_ID.`);
 add('relayer','Signing operator',account(env.NEAR_RELAYER_ACCOUNT_ID)&&secretKey(env.NEAR_RELAYER_PRIVATE_KEY)&&positive(env.NEAR_RELAYER_DAILY_BUDGET_YOCTO)&&Boolean(env.NEAR_RELAYER_SIGN_DEPOSIT_YOCTO&&/^\d{1,31}$/.test(env.NEAR_RELAYER_SIGN_DEPOSIT_YOCTO)),`Configure the funded ${network} relayer key, verified MPC signing deposit and a positive daily sponsorship budget.`);
 add('oracle','Gameplay operator',account(env.NEAR_ORACLE_ACCOUNT_ID)&&secretKey(env.NEAR_ORACLE_PRIVATE_KEY),`Configure the funded ${network} harvest oracle. Account withdrawals do not depend on this operator.`);
 const merchantIds=merchantKeys.map(key=>env[key]);
 add('merchants','Town businesses',merchantIds.every(account)&&new Set(merchantIds).size===4,`Configure four distinct registered ${network} merchant accounts.`);
 add('release',`${testnet?'Testnet':'Mainnet'} release`,env[testnet?'ENABLE_TESTNET':'ENABLE_MAINNET']==='true',`Enable the selected network explicitly; ${testnet?'test tokens have no monetary value':'mainnet spends real NEAR'}.`);
 checks.push({id:'auth-service',label:'NEAR Auth service',status:'unverified',detail:'Issuer, signing keys and callback acceptance have not been checked.'},{id:'storage',label:'Persistent storage',status:'unverified',detail:'The storage write/read/delete check has not passed.'},{id:'chain',label:'Account contract and signing operator',status:'unverified',detail:'The contract and funded signing operator have not been checked.'},{id:'gameplay-chain',label:'Town economy and harvest operator',status:'unverified',detail:'Merchants and the funded harvest operator have not been checked.'});
 return checks;
}
type Probes={database:(url:string)=>Promise<void>;localStorage?:(directory:string)=>Promise<void>;auth:(env:Environment)=>Promise<void>;chain:(env:Environment)=>Promise<void>;gameplay:(env:Environment)=>Promise<void>};
const fingerprint=(env:Environment)=>createHash('sha256').update(JSON.stringify(Object.entries(env).filter(([k])=>k.startsWith('NEAR_')||['DATABASE_URL','LOCAL_DATA_DIR','TESTNET_SINGLE_PROCESS','PUBLIC_URL','APP_ORIGIN','APP_MODE','NODE_ENV','ENABLE_MAINNET','ENABLE_TESTNET'].includes(k)).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');

/** Only readiness reads may retry. This helper rejects transaction RPC methods
 * before touching the network and shares one timeout across at most two tries. */
export async function readOnlyReadinessFetch(input:string|URL,init:RequestInit={},timeoutMs=10000):Promise<Response>{
 const method=(init.method||'GET').toUpperCase();
 if(method==='POST'){
  let rpcMethod:unknown;try{rpcMethod=JSON.parse(String(init.body)).method;}catch{/* rejected below */}
  if(rpcMethod!=='query'&&rpcMethod!=='status')throw new Error('Readiness retries accept read-only RPC methods only.');
 }else if(method!=='GET')throw new Error('Readiness retries accept read-only requests only.');
 const deadline=Date.now()+timeoutMs;
 const transient=(error:unknown)=>{
  const value=error as {name?:string;message?:string;cause?:{code?:string};code?:string};
  const code=value?.cause?.code||value?.code;
  return Boolean(code&&['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(code)||value?.name==='TypeError'&&/fetch failed|network/i.test(value.message||''));
 };
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await fetch(input,{...init,signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
   if(attempt===0&&[502,503,504].includes(response.status)&&deadline-Date.now()>150){await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,150));continue;}
   return response;
  }catch(error){
   if(attempt!==0||!transient(error)||deadline-Date.now()<=150)throw error;
   await new Promise(resolve=>setTimeout(resolve,150));
  }
 }
 throw new Error('Readiness request failed.');
}

/** The result is tied to the entire deployment configuration and expires quickly.
 * No real-money operation may infer readiness from variable presence alone. */
export function createReadinessChecker(probes:Probes,now:()=>number=Date.now){
 let cache:{key:string;until:number;result:ProductionReadiness}|undefined;
 let pending:{key:string;promise:Promise<ProductionReadiness>}|undefined;
 const snapshot=(env:Environment):ProductionReadiness=>{const key=fingerprint(env);return cache?.key===key&&cache.until>now()?structuredClone(cache.result):{ready:false,accountReady:false,checkedAt:null,checks:configurationChecks(env)};};
 async function refresh(env:Environment):Promise<ProductionReadiness>{
  const key=fingerprint(env),existing=snapshot(env);if(existing.checkedAt!==null)return existing;if(pending?.key===key)return pending.promise;
  const promise=(async()=>{
   const checks=configurationChecks(env),ready=(id:string)=>checks.some(c=>c.id===id&&c.status==='ready');let failedProbe=false;
   const run=async(id:string,allowed:boolean,probe:()=>Promise<void>,success:string,failure:string)=>{
    if(!allowed)return;const item=checks.find(c=>c.id===id)!;
    try{await probe();item.status='ready';item.detail=success;}catch{failedProbe=true;item.status='unverified';item.detail=failure;}
   };
   await Promise.all([
    run('storage',ready('database'),()=>env.DATABASE_URL?probes.database(env.DATABASE_URL):probes.localStorage?probes.localStorage(env.LOCAL_DATA_DIR!):Promise.reject(new Error('Storage probe unavailable.')),'Storage write, read and cleanup succeeded.','Persistence could not be verified. Chain operations remain unavailable.'),
    run('auth-service',ready('network')&&ready('origin')&&ready('social'),()=>probes.auth(env),'Issuer, signing keys and callback acceptance passed read-only checks; actual sign-in remains a separate test.','Social sign-in could not be verified for this origin. Check the allowed callback and provider availability.'),
    run('chain',['network','contract','relayer'].every(ready),()=>probes.chain(env),'Selected network, contract and funded signing operator passed read-only checks.','The selected chain, contract or signing operator could not be verified.'),
    run('gameplay-chain',['network','contract','oracle','merchants'].every(ready),()=>probes.gameplay(env),'Registered merchants and the funded harvest operator passed read-only checks.','The town economy or harvest operator could not be verified. Account operations may remain available.'),
   ]);
   const result={ready:checks.every(c=>c.status==='ready'),accountReady:accountChecks.every(ready),checkedAt:now(),checks};cache={key,until:now()+(failedProbe?5000:60000),result};return structuredClone(result);
  })().finally(()=>{if(pending?.key===key)pending=undefined;});pending={key,promise};return promise;
 }
 return{snapshot,refresh};
}

async function verifyDatabase(url:string){
 const sql=neon(url,{fetchOptions:{signal:AbortSignal.timeout(12000)}}),id=randomUUID();
 await sql`CREATE TABLE IF NOT EXISTS worldo_readiness_probe (id uuid PRIMARY KEY)`;
 const result=await sql.transaction([
  sql`INSERT INTO worldo_readiness_probe(id) VALUES(${id}) RETURNING id`,
  sql`SELECT id FROM worldo_readiness_probe WHERE id=${id}`,
  sql`DELETE FROM worldo_readiness_probe WHERE id=${id} RETURNING id`,
 ]);
 if(result.length!==3||result.some(rows=>rows.length!==1||rows[0].id!==id))throw new Error('Database persistence verification failed.');
}
async function verifyLocalStorage(directory:string){
 const folder=path.resolve(directory),id=randomUUID(),file=path.join(folder,`worldo-readiness-${id}.tmp`);let created=false;
 await mkdir(folder,{recursive:true});
 try{const handle=await open(file,'wx',0o600);created=true;try{await handle.writeFile(id);await handle.sync();}finally{await handle.close();}if(await readFile(file,'utf8')!==id)throw new Error('Local storage verification failed.');}
 finally{if(created)await unlink(file);}
}
/** No cookies, credentials, token exchange or social sign-in. An allowed callback
 * returns a login-required error to our own origin; disallowed origins fail. */
export async function verifyAuthCallback(env:Environment){
 const config=nearAuthConfiguration(env),url=new URL('authorize',config.issuer);
 url.search=new URLSearchParams({client_id:config.clientId!,response_type:'code',redirect_uri:config.appOrigin,scope:'openid',audience:config.audience,prompt:'none',code_challenge:'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',code_challenge_method:'S256',state:randomUUID()}).toString();
 const response=await readOnlyReadinessFetch(url,{redirect:'manual',credentials:'omit'}),location=response.headers.get('location');
 if(response.status<300||response.status>=400||!location)throw new Error('Auth callback is not available.');
 const target=new URL(location,url),expected=new URL(config.appOrigin),error=target.searchParams.get('error')||new URLSearchParams(target.hash.slice(1)).get('error');
 if(target.origin!==expected.origin||target.pathname!==expected.pathname||!['login_required','consent_required','interaction_required','account_selection_required'].includes(error||''))throw new Error('Auth callback is not available.');
}
async function verifyAuthService(env:Environment){
 const config=nearAuthConfiguration(env);
 const discovery=await readOnlyReadinessFetch(new URL('.well-known/openid-configuration',config.issuer));
 const data=await discovery.json() as {issuer?:string;jwks_uri?:string};
 if(!discovery.ok||data.issuer!==config.issuer||data.jwks_uri!==new URL('.well-known/jwks.json',config.issuer).toString())throw new Error('Unexpected issuer discovery.');
 const response=await readOnlyReadinessFetch(data.jwks_uri),keys=await response.json() as {keys?:{kty?:string;use?:string;alg?:string}[]};
 if(!response.ok||!keys.keys?.some(k=>k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256')))throw new Error('Signing keys unavailable.');
 await verifyAuthCallback(env);
}
export async function verifyChainDeployment(env:Environment,scope:'account'|'gameplay'|'all'='all'){
 const chain=nearNetworkConfiguration(env);
 const rpc=async(method:string,params:unknown)=>{
  const response=await readOnlyReadinessFetch(chain.rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'worldo-readiness',method,params})},12000);
  const data=await response.json() as {result?:unknown;error?:unknown};if(!response.ok||data.error||data.result===undefined)throw new Error('Chain verification failed.');return data.result;
 };
 const status=await rpc('status',[]) as {chain_id?:string};if(status.chain_id!==chain.network)throw new Error('Wrong chain.');
 const query=(params:Record<string,unknown>)=>rpc('query',{finality:'final',...params});
 const view=async(method:string,args:unknown)=>{const result=await query({request_type:'call_function',account_id:env.NEAR_CONTRACT_ID,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')}) as {result:number[]};return JSON.parse(Buffer.from(result.result).toString()) as unknown;};
 if(scope!=='gameplay'){
  const account=await query({request_type:'view_account',account_id:env.NEAR_CONTRACT_ID}) as {code_hash?:string};if(!account.code_hash||/^1+$/.test(account.code_hash)||typeof await view('is_paused',{})!=='boolean')throw new Error('Game contract unavailable.');
 }
 // A merchant may legitimately spend its entire buying budget. This must not
 // disable the player's account or withdrawals; trade validates affordability.
 const goods=['crude','ore','timber','petrol'];
 if(scope!=='account')await Promise.all(merchantKeys.map(async(key,i)=>{
  const [holding,quote]=await Promise.all([view('account',{account_id:env[key]}),view('quote',{merchant_id:env[key],token_id:goods[i],amount:'1',buy:false})]);
  const m=holding as {balance?:string;inventory?:string[]}|null;
  if(!m||!m.balance||!/^\d+$/.test(m.balance)||m.inventory?.length!==6||m.inventory.some(n=>!/^\d+$/.test(n))||typeof quote!=='string'||!positive(quote))throw new Error('Merchant not registered.');
 }));
 for(const prefix of scope==='account'?['NEAR_RELAYER']:scope==='gameplay'?['NEAR_ORACLE']:['NEAR_RELAYER','NEAR_ORACLE']){
  const id=env[`${prefix}_ACCOUNT_ID`]!,key=KeyPair.fromString(env[`${prefix}_PRIVATE_KEY`] as `ed25519:${string}`);
  const [balance,access]=await Promise.all([query({request_type:'view_account',account_id:id}),query({request_type:'view_access_key',account_id:id,public_key:key.getPublicKey().toString()})]) as [{amount:string;storage_usage:number},{permission:unknown}];
  if(BigInt(balance.amount)<=BigInt(balance.storage_usage)*10n**19n)throw new Error('Operator has no spendable NEAR.');
  if(access.permission!=='FullAccess')throw new Error('Operator key permissions require review.');
 }
}
export const verifyMainnetDeployment=verifyChainDeployment;
const checker=createReadinessChecker({database:verifyDatabase,localStorage:verifyLocalStorage,auth:verifyAuthService,chain:env=>verifyChainDeployment(env,'account'),gameplay:env=>verifyChainDeployment(env,'gameplay')});
export const productionReadinessSnapshot=()=>checker.snapshot(process.env);
export const getProductionReadiness=()=>checker.refresh({...process.env});
export function requiresGameplayReadiness(method:string){return !['register','deposit','withdraw','unwrap'].includes(method);}
export async function assertAccountReady(){
 const chain=nearNetworkConfiguration();
 if(chain.testnet&&appMode()==='development')return;
 if(!(await getProductionReadiness()).accountReady)throw new Error('NEAR account operations are awaiting verified configuration. No transaction was submitted.');
}
export async function assertTransactionReady(method:string){
 if(requiresGameplayReadiness(method))await assertMainnetReady();else await assertAccountReady();
}
export async function assertMainnetReady(){
 const chain=nearNetworkConfiguration();
 if(chain.testnet&&appMode()==='development')return;
 if(!(await getProductionReadiness()).ready)throw new Error('NEAR is awaiting verified configuration. No transaction was submitted.');
}
