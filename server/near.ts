import {Router, type Request} from 'express';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {createRemoteJWKSet, jwtVerify} from 'jose';
import bs58 from 'bs58';
import {z} from 'zod';
import {nearAuthConfiguration,nearAuthDerivationPath} from './near-config';
import {actionCost,checkReviewedFee,prepareGameTransaction,assertSponsoredDelegate} from './transaction-policy';
import {localRelayerConfigured,relayAuthorizedSignature,submitSponsoredDelegate,submitUserTransaction,provisionNearWallet} from './relayer';

const issuerKeys=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
function authKeys(issuer:string){let keys=issuerKeys.get(issuer);if(!keys){keys=createRemoteJWKSet(new URL('.well-known/jwks.json',issuer));issuerKeys.set(issuer,keys);}return keys;}
function verifyAuthToken(token:string){const config=nearAuthConfiguration();return jwtVerify(token,authKeys(config.issuer),{issuer:config.issuer,audience:config.audience,algorithms:['RS256'],maxTokenAge:'5m'});}
type Challenge={message:string;recipient:string;nonce:number[];expiresAt:number};
export type NearIdentity={accountId:string;publicKey:string;expiresAt:number;authSubject:string};
const challenges=new Map<string,Challenge>();
const identities=new Map<string,NearIdentity>();
type PendingAction=ReturnType<typeof prepareGameTransaction>&{session:string;ownerAccountId:string;expiresAt:number;method:string;deposit:string;reviewedFeeCeiling?:string};
const pendingActions=new Map<string,PendingAction>();
const amount=z.string().regex(/^\d{1,26}$/);
const resource=z.enum(['crude','ore','timber','petrol','steel','planks']);
const account=z.string().min(2).max(64).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const ACTION_ARGS={
 register:z.object({}).strict(),deposit:z.object({account_id:account.nullable().optional()}).strict(),
 withdraw:z.object({amount}).strict(),
 trade:z.object({merchant_id:account,token_id:resource,amount:z.string().regex(/^[1-9]\d{0,2}$/).refine(n=>BigInt(n)<=100n),buy:z.boolean(),limit:amount}).strict(),
 process:z.object({merchant_id:account,token_id:z.enum(['crude','ore','timber']),batches:z.number().int().min(1).max(20)}).strict(),
 build_refinery:z.object({}).strict(),refine_owned:z.object({batches:z.number().int().min(1).max(20)}).strict(),
 unwrap:z.object({amount:amount.refine(n=>BigInt(n)>0n)}).strict(),
};
export function validateContractAction(method:unknown,args:unknown,deposit:unknown){
 if(typeof method!=='string'||!Object.hasOwn(ACTION_ARGS,method))throw new Error('Unsupported game transaction.');
 const parsed=ACTION_ARGS[method as keyof typeof ACTION_ARGS].parse(args);
 if(typeof deposit!=='string'||!/^\d{1,26}$/.test(deposit))throw new Error('Invalid attached amount.');
 const value=BigInt(deposit);
 if(method==='register'){if(value<10n**22n||value>10n**25n)throw new Error('Registration requires 0.01–10 NEAR.');}
 else if(method==='deposit'){if(value<=0n||value>10n**25n)throw new Error('Deposit must be at most 10 NEAR.');}
 else if(value!==1n)throw new Error('This action requires exactly one yoctoNEAR.');
 return{method,args:parsed,deposit};
}
export function sessionId(req:Request):string {const id=(req as Request & {sessionId?:string}).sessionId;if(!id)throw new Error('Start a game session first.');return id;}
export function getVerifiedIdentity(req:Request):NearIdentity|null {const id=identities.get(sessionId(req));if(!id||id.expiresAt<Date.now())return null;return id;}
export function nearConfiguration(){
 const auth=nearAuthConfiguration();
 const authConfigured=Boolean(auth.clientId);
 const contractId=process.env.NEAR_CONTRACT_ID||null;
 const liveEnabled=authConfigured&&Boolean(contractId)&&process.env.ENABLE_MAINNET==='true';
 const liveGameplayEnabled=liveEnabled&&Boolean(process.env.NEAR_ORACLE_ACCOUNT_ID&&process.env.NEAR_ORACLE_PRIVATE_KEY&&process.env.DATABASE_URL&&process.env.NEAR_REFINERY_ACCOUNT&&process.env.NEAR_FOUNDRY_ACCOUNT&&process.env.NEAR_SAWMILL_ACCOUNT&&process.env.NEAR_DEPOT_ACCOUNT)&&(localRelayerConfigured()||Boolean(process.env.NEAR_AUTH_RELAYER_URL));
 return {network:'mainnet' as const,authConfigured,clientId:auth.clientId,authDomain:auth.domain,authAudience:auth.audience,authGuardId:auth.guardId,appOrigin:auth.appOrigin,contractConfigured:Boolean(contractId),contractId,liveEnabled,liveGameplayEnabled,walletSetupEnabled:localRelayerConfigured(),relayerConfigured:localRelayerConfigured()||Boolean(process.env.NEAR_AUTH_RELAYER_URL),message:liveEnabled?'Mainnet funding available.':!authConfigured?'Mainnet social sign-in awaits approved NEAR Auth credentials.':'Mainnet gameplay has not been enabled.'};
}
export async function nearRpc<T>(params:Record<string,unknown>,method='query'):Promise<T>{
 const response=await fetch(process.env.NEAR_RPC_URL||'https://rpc.mainnet.near.org',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'lowland',method,params}),signal:AbortSignal.timeout(method==='query'?15000:60000)});
 if(!response.ok)throw new Error('NEAR is temporarily unavailable.');
 const body=await response.json() as {result?:T;error?:unknown};
 if(body.error||body.result===undefined)throw new Error('Unable to read the NEAR account.');
 return body.result;
}
export async function viewContract<T>(accountId:string,method:string,args:unknown):Promise<T>{
 const result=await nearRpc<{result:number[]}>({request_type:'call_function',finality:'final',account_id:accountId,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')});
 return JSON.parse(Buffer.from(result.result).toString()) as T;
}
export function encodeChallenge(challenge:Challenge):Buffer{
 const u32=(value:number)=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
 const string=(s:string)=>{const b=Buffer.from(s);return Buffer.concat([u32(b.length),b]);};
 return Buffer.concat([u32(2**31+413),string(challenge.message),Buffer.from(challenge.nonce),string(challenge.recipient),Buffer.from([0])]);
}
export function validateChallengePayload(payload:unknown,challenge:Challenge):boolean{
 if(!Array.isArray(payload)||payload.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const expected=encodeChallenge(challenge),actual=Buffer.from(payload);
 return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function executionSucceeded(outcome:Record<string,unknown>):boolean{
 const status=outcome.status;
 if(!status||typeof status!=='object'||!('SuccessValue'in status))return false;
 const receipts=outcome.receipts_outcome;
 return !Array.isArray(receipts)||receipts.every((receipt)=>{
  const receiptStatus=receipt?.outcome?.status;
  return !receiptStatus||typeof receiptStatus!=='object'||!('Failure'in receiptStatus);
 });
}
export function createNearRouter(){
 const router=Router();
 router.get('/status',(_req,res)=>res.json(nearConfiguration()));
 router.get('/identity',(req,res)=>{const i=getVerifiedIdentity(req);res.json({identity:i?{accountId:i.accountId,publicKey:i.publicKey,expiresAt:i.expiresAt}:null});});
 router.post('/challenge',(req,res)=>{
  if(!nearConfiguration().authConfigured){res.status(503).json({error:'NEAR Auth mainnet credentials are not configured.'});return;}
  for(const [key,value]of challenges)if(value.expiresAt<Date.now())challenges.delete(key);
  if(challenges.size>10000){res.status(429).json({error:'Try signing in again shortly.'});return;}
  const challenge:Challenge={message:'Sign in to Lowland. This does not authorize a payment.',recipient:new URL(nearAuthConfiguration().appOrigin).host,nonce:[...randomBytes(32)],expiresAt:Date.now()+5*60_000};
  challenges.set(sessionId(req),challenge);res.json(challenge);
 });
 router.post('/verify',async(req,res)=>{
  const sid=sessionId(req),challenge=challenges.get(sid);
  // Consume before verification; a failed or concurrent attempt must start again.
  challenges.delete(sid);
  if(!challenge||challenge.expiresAt<Date.now()){res.status(401).json({error:'Sign-in expired. Please sign in again.'});return;}
  if(typeof req.body?.token!=='string'||req.body.token.length>20000){res.status(400).json({error:'Invalid sign-in response.'});return;}
  try{
   const {payload}=await verifyAuthToken(req.body.token);
   if(!payload.sub||payload.azp!==nearAuthConfiguration().clientId||!validateChallengePayload(payload.fatxn,challenge))throw new Error('Invalid authentication binding.');
   const publicKey=await viewContract<string>('v1.signer','derived_public_key',{path:nearAuthDerivationPath(payload.sub),predecessor:'fast-auth.near',domain_id:1});
   if(typeof publicKey!=='string'||!publicKey.startsWith('ed25519:'))throw new Error('Unsupported derived key.');
   const bytes=bs58.decode(publicKey.slice(8));if(bytes.length!==32)throw new Error('Invalid derived key.');
   const identity:NearIdentity={authSubject:payload.sub,accountId:Buffer.from(bytes).toString('hex'),publicKey,expiresAt:Date.now()+60*60_000};
   identities.set(sid,identity);res.json({identity:{accountId:identity.accountId,publicKey,expiresAt:identity.expiresAt}});
  }catch{res.status(401).json({error:'Could not verify your NEAR sign-in. Please try again.'});}
 });
 router.post('/logout',(req,res)=>{identities.delete(sessionId(req));challenges.delete(sessionId(req));res.json({ok:true});});
 router.get('/balance',async(req,res)=>{
  const identity=getVerifiedIdentity(req);if(!identity){res.status(401).json({error:'Sign in first.'});return;}
  try{const [account,wrappedAmount,storage]=await Promise.all([nearRpc<{amount:string}>({request_type:'view_account',finality:'final',account_id:identity.accountId}),viewContract<string>('wrap.near','ft_balance_of',{account_id:identity.accountId}),viewContract<unknown>('wrap.near','storage_balance_of',{account_id:identity.accountId})]);res.json({accountId:identity.accountId,amount:account.amount,wrappedAmount,decimals:24,walletReady:Boolean(storage),network:'mainnet'});}
  catch{res.status(503).json({error:'The account balance is not available yet.'});}
 });
 router.post('/prepare-wallet',async(req,res)=>{
  const identity=getVerifiedIdentity(req);if(!identity||!nearConfiguration().liveEnabled){res.status(403).json({error:'Sign in to an enabled mainnet deployment first.'});return;}
  try{res.json(await provisionNearWallet(identity.accountId));}catch(error){res.status(503).json({error:error instanceof Error?error.message:'Wallet preparation is unavailable.'});}
 });
 router.get('/account',async(req,res)=>{
  const identity=getVerifiedIdentity(req),config=nearConfiguration();
  if(!identity||!config.contractId){res.status(403).json({error:'Sign in to an enabled mainnet deployment first.'});return;}
  try{res.json({account:await viewContract(config.contractId,'account',{account_id:identity.accountId}),paused:await viewContract(config.contractId,'is_paused',{}),network:'mainnet'});}
  catch{res.status(503).json({error:'The game contract could not be read.'});}
 });
 router.post('/action-cost',async(req,res)=>{
  const identity=getVerifiedIdentity(req);
  if(!identity||!nearConfiguration().liveEnabled){res.status(403).json({error:'Sign in to an enabled mainnet deployment first.'});return;}
  try{const action=validateContractAction(req.body?.method,req.body?.args,req.body?.deposit);const price=await nearRpc<{gas_price:string}>({block_id:null},'gas_price');res.json({...actionCost(action.method,action.deposit,price.gas_price),accountId:identity.accountId});}
  catch(error){res.status(422).json({error:error instanceof Error?error.message:'Network costs are unavailable.'});}
 });
 router.post('/prepare-action',async(req,res)=>{
  const identity=getVerifiedIdentity(req),config=nearConfiguration();
  if(!identity||!config.liveEnabled||!config.contractId||!config.relayerConfigured){res.status(403).json({error:'Mainnet game transactions are not enabled.'});return;}
  try{
   const action=validateContractAction(req.body?.method,req.body?.args,req.body?.deposit);
   if(req.body?.approvedCost?.accountId!==identity.accountId)throw new Error('The signed-in account changed. Review this action again.');
   if(action.method==='deposit'&&'account_id'in action.args&&action.args.account_id&&action.args.account_id!==identity.accountId)throw new Error('This flow funds only your own game account.');
   const access=await nearRpc<{nonce:number;block_hash:string;block_height:number}>({request_type:'view_access_key',finality:'final',account_id:identity.accountId,public_key:identity.publicKey});
   const price=await nearRpc<{gas_price:string}>({block_id:null},'gas_price');
   const cost=actionCost(action.method,action.deposit,price.gas_price),reviewedFeeCeiling=checkReviewedFee(req.body?.approvedCost,cost);
   if(!cost.gasSponsored){const wallet=await nearRpc<{amount:string}>({request_type:'view_account',finality:'final',account_id:identity.accountId});if(BigInt(wallet.amount)<BigInt(action.deposit)+BigInt(cost.feeEstimateYocto))throw new Error('Your wallet needs the attached payment plus native NEAR for the network fee.');}
   const prepared=prepareGameTransaction({accountId:identity.accountId,publicKey:identity.publicKey,contractId:config.contractId,...action,access});
   for(const [key,pending]of pendingActions)if(pending.expiresAt<Date.now())pendingActions.delete(key);
   if(pendingActions.size>10000)throw new Error('Transaction queue is busy.');
   const id=randomUUID();pendingActions.set(id,{...prepared,session:sessionId(req),ownerAccountId:identity.accountId,method:action.method,deposit:action.deposit,reviewedFeeCeiling,expiresAt:Date.now()+5*60_000});
   res.json({id,payload:[...prepared.bytes],signerId:identity.accountId,publicKey:identity.publicKey,receiverId:prepared.receiverId,nonce:prepared.nonce,...action,...cost});
  }catch(error){res.status(422).json({error:error instanceof z.ZodError?'Invalid game transaction.':error instanceof Error?error.message:'Unable to prepare transaction.'});}
 });
 router.post('/relay',async(req,res)=>{
  const identity=getVerifiedIdentity(req),id=req.body?.id,pending=pendingActions.get(id);
  if(!identity||!nearConfiguration().liveEnabled||!nearConfiguration().relayerConfigured||!pending||pending.session!==sessionId(req)||pending.ownerAccountId!==identity.accountId||pending.expiresAt<Date.now()){res.status(403).json({error:'Transaction authorization expired or is unavailable.'});return;}
  pendingActions.delete(id);
  try{
   if(typeof req.body.token!=='string'||req.body.token.length>30000)throw new Error('Invalid authorization.');
   const {payload}=await verifyAuthToken(req.body.token);
   if(payload.sub!==identity.authSubject||payload.azp!==nearAuthConfiguration().clientId||!Array.isArray(payload.fatxn)||payload.fatxn.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error('Invalid authorization.');
   const bytes=Buffer.from(payload.fatxn);if(bytes.length!==pending.bytes.length||!timingSafeEqual(bytes,pending.bytes))throw new Error('Transaction does not match the approved action.');
   let outcome:Record<string,unknown>;
   const ensureReviewedFee=async()=>{
    if(pending.kind!=='transaction')return;
    const price=await nearRpc<{gas_price:string}>({block_id:null},'gas_price');
    if(!pending.reviewedFeeCeiling||BigInt(actionCost(pending.method,pending.deposit,price.gas_price).feeEstimateYocto)>BigInt(pending.reviewedFeeCeiling))throw new Error('Network costs changed. Review a new transaction.');
   };
   await ensureReviewedFee();
   if(pending.kind==='delegateAction')assertSponsoredDelegate(pending.delegate);
   if(localRelayerConfigured()){
    const signature=await relayAuthorizedSignature(req.body.token,[...bytes]);
    await ensureReviewedFee();
    outcome=pending.kind==='transaction'?await submitUserTransaction(pending.transaction,signature):await submitSponsoredDelegate(pending.delegate,signature);
   }
   else{
    const route=pending.kind==='transaction'?'sign-tx':'sign-delegate-tx';
    const url=new URL(`${process.env.NEAR_AUTH_RELAYER_URL!.replace(/\/$/,'')}/${route}`);if(url.protocol!=='https:')throw new Error('Relayer must use HTTPS.');
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(process.env.NEAR_AUTH_RELAYER_TOKEN?{Authorization:`Bearer ${process.env.NEAR_AUTH_RELAYER_TOKEN}`}:{} )},body:JSON.stringify({guard_id:nearAuthConfiguration().guardId,verify_payload:req.body.token,sign_payload:[...bytes],algorithm:'eddsa',...(pending.kind==='delegateAction'?{receiver_id:identity.accountId}:{})}),signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error('The signing service is temporarily unavailable.');
    const result=await response.json() as {result?:Record<string,unknown>};
    if(!result.result)throw new Error('The signing service did not return an execution result.');
    if(pending.kind==='transaction'){
     const signature=(result.result.status as {SuccessValue?:string})?.SuccessValue;
     if(!signature||!executionSucceeded(result.result))throw new Error('The signing service did not return a successful signature.');
     await ensureReviewedFee();outcome=await submitUserTransaction(pending.transaction,signature);
    }else outcome=result.result;
   }
   const hash=(outcome.transaction as {hash?:string})?.hash;
   if(!hash)throw new Error('Transaction confirmation is unavailable. Check your account before trying again.');
   const sender=(outcome.transaction as {signer_id?:string}).signer_id;
   if(sender)outcome=await nearRpc({tx_hash:hash,sender_account_id:sender,wait_until:'FINAL'},'tx');
   if(!executionSucceeded(outcome)){res.status(422).json({error:`The game transaction failed. Receipt: https://nearblocks.io/txns/${hash}`,hash,explorerUrl:`https://nearblocks.io/txns/${hash}`});return;}
   res.json({hash,explorerUrl:`https://nearblocks.io/txns/${hash}`,outcome,gasSponsored:pending.kind==='delegateAction',attachedDepositPayer:pending.kind==='delegateAction'?'sponsor':'player'});
  }catch{res.status(422).json({error:'The transaction could not be confirmed. Check your account before trying again.'});}
 });
 return router;
}
