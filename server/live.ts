import {SERVICE_NPCS} from '../shared/town';
import {nearNetworkConfiguration} from './near-config';
import {assertMainnetReady} from './production-readiness';
import {Router,type Request} from 'express';
import {createHash,randomUUID} from 'node:crypto';
import {getVerifiedIdentity} from './near';
import * as chain from './game-chain';
import {GameStore} from './store';
import {applyAction,GameError,type SavedGame,type OracleCommand} from './economy';
import {actionSchema} from './action-schema';
import {PLACES,TRUCK_POSITION,RESOURCE_NAMES,type GameState,type GameAction,type PlaceId,type Resource} from '../shared/types';
import {MERCHANT_GOODS,RECIPES} from '../shared/economy-rules';

export interface ChainAction {method:string;args:Record<string,unknown>;deposit:string;label:string;receiverId?:string;costYocto?:string;receiveYocto?:string;}
type Economy=Awaited<ReturnType<typeof chain.readLiveEconomy>>;
export interface LiveGateway {
 configured():boolean;
 read(accountId:string):Promise<Economy>;
 quote(place:PlaceId,resource:Resource,quantity:number,buy:boolean):Promise<string>;
 harvest(accountId:string,resource:'crude'|'ore'|'timber',amount:number,nonce:number):Promise<chain.ChainReceipt>;
 fuel(accountId:string,amount:number,nonce:number):Promise<chain.ChainReceipt>;
 merchants():Partial<Record<PlaceId,string>>;
}
const defaultGateway:LiveGateway={configured:chain.gameChainConfigured,read:chain.readLiveEconomy,quote:chain.liveTradeQuote,harvest:chain.submitHarvestGrant,fuel:chain.submitFuelConsumption,merchants:chain.merchantAccounts};
const UNIT=10n**21n;
export const liveAccountKey=(accountId:string)=>{
 const contractId=process.env.NEAR_CONTRACT_ID;if(!contractId)throw new Error('Game contract is not configured.');
 // Oracle nonces belong to one deployment. Legacy records cannot prove their
 // contract, so leave them untouched rather than carrying a pending grant across.
 return createHash('sha256').update(JSON.stringify(['worldo-live-v2',nearNetworkConfiguration().network,contractId,accountId])).digest('hex');
};
const nearAmount=(amount:string)=>{const n=Number(amount)/1e24;if(!Number.isFinite(n))throw new Error('Invalid chain balance');return n;};
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const assert=(ok:unknown,message:string,status=400)=>{if(!ok)throw new GameError(message,status);};
const isNear=(state:GameState,place:PlaceId)=>distance(state.player.position,PLACES.find(p=>p.id===place)!.position)<=10||SERVICE_NPCS.some(n=>n.place===place&&distance(state.player.position,n.position)<=3.5);
const requireNear=(state:GameState,place:PlaceId)=>assert(isNear(state,place),'Move closer to this business or resource site.');
const note=(state:GameState,text:string)=>{state.activities.unshift({id:randomUUID(),text,at:Date.now()});state.activities=state.activities.slice(0,30);};

export function projectChainState(saved:SavedGame,accountId:string,economy:Economy):SavedGame {
 assert(economy.player,'Register your game account before entering chain.',409);assert(!economy.paused,'The chain economy is paused.',503);
 assert(economy.merchants.length===4&&economy.merchants.every(m=>m.account),'All four chain businesses must be registered.',503);
 const next=structuredClone(saved),s=next.state,p=economy.player!;
 next.meta.confirmedOracleNonce=Math.max(next.meta.confirmedOracleNonce??0,p.harvest_nonce);
 s.mode='live';s.player.id=accountId;s.player.balance=nearAmount(p.balance);s.player.inventory=chain.inventoryFromChain(p);s.player.facility=p.refinery;
 s.merchants=economy.merchants.map(m=>({id:m.place,name:PLACES.find(p=>p.id===m.place)!.name,budget:nearAmount(m.account!.balance),stock:chain.inventoryFromChain(m.account!)}));
 s.live={accountId,balanceYocto:p.balance,scannerCost:0,processingFee:.001,build:{steel:10,planks:10,credits:0},ownedRecipes:['crude'],pendingOracle:!!next.meta.pendingOracle,...(s.live?.receipt?{receipt:s.live.receipt}:{})};
 return next;
}

/** Persistent account state never inherits a guest world's money, items or progress. */
export class LiveGameService {
 constructor(private store:GameStore,private gateway:LiveGateway=defaultGateway){}
 private key(id:string){return liveAccountKey(id);}
 async session(accountId:string){
  const key=this.key(accountId);await this.store.create(key);
  // A previously authorized oracle command may have completed while its HTTP response was lost.
  await this.reconcile(accountId);
  const economy=await this.gateway.read(accountId);
  const saved=await this.store.mutate(key,old=>{
   const n=projectChainState(old,accountId,economy);
   if(old.state.mode!=='live'){n.state.activities=[];note(n.state,'Chain world started. Inventory and balances are read from the game contract.');}
   const today=Math.floor(Date.now()/86400000),elapsed=Math.max(0,today-(n.meta.liveDay??today));
   if(elapsed&&!n.meta.pendingOracle){n.state.day+=elapsed;n.state.deposits={crude:Math.min(80,(n.state.deposits?.crude??0)+12*elapsed),ore:Math.min(100,(n.state.deposits?.ore??0)+16*elapsed),timber:Math.min(100,(n.state.deposits?.timber??0)+16*elapsed)};}
   if(!n.meta.pendingOracle)n.meta.liveDay=today;n.state.revision++;return n;
  });
  return saved.state;
 }
 private async reconcile(accountId:string){
  const key=this.key(accountId),current=await this.store.get(key),pending=current?.meta.pendingOracle;
  if(!pending)return;
  const economy=await this.gateway.read(accountId);assert(economy.player,'The chain account is unavailable.',503);
  const nonce=economy.player!.harvest_nonce;
  if(nonce<pending.nonce)return;
  assert(nonce===pending.nonce,'An oracle command needs operator review before this world can continue.',409);
  await this.store.mutate(key,old=>{
   if(old.meta.pendingOracle?.nonce!==pending.nonce)return old;
   const command=old.meta.pendingOracle;
   const n=projectChainState({...old,state:{...command.after,revision:old.state.revision}},accountId,economy);
   n.meta.lastGatherAt=command.lastGatherAt;n.meta.pendingOracle=undefined;n.meta.requests=n.meta.requests.slice(-255);n.meta.requests.push({id:command.requestId,at:Date.now()});
   n.meta.confirmedOracleNonce=command.nonce;n.meta.oracleReceipts??={};n.meta.oracleReceipts[command.requestId]={nonce:command.nonce,at:Date.now(),kind:command.kind,amount:command.amount,...(command.receipt?{hash:command.receipt.hash}:{})};
   n.state.live!.pendingOracle=false;if(command.receipt)n.state.live!.receipt=command.receipt;n.state.revision++;return n;
  });
 }
 private async broadcast(accountId:string){
  const key=this.key(accountId);let command:OracleCommand|undefined;
  await this.store.mutate(key,old=>{
   const pending=old.meta.pendingOracle,now=Date.now();command=undefined;
   // A durable lease prevents two Fly machines from broadcasting the same journal entry simultaneously.
   if(!pending||pending.attempts>=3||now-pending.lastAttemptAt<65000)return old;
   const n=structuredClone(old);n.meta.pendingOracle!.lastAttemptAt=now;n.meta.pendingOracle!.attempts++;n.state.revision++;command=structuredClone(n.meta.pendingOracle!);return n;
  });
  if(!command)return;
  const selected=command as OracleCommand;
  try{
   const receipt=selected.kind==='harvest'?await this.gateway.harvest(accountId,selected.resource,selected.amount,selected.nonce):await this.gateway.fuel(accountId,selected.amount,selected.nonce);
   await this.store.mutate(key,old=>{if(old.meta.pendingOracle?.nonce!==selected.nonce)return old;const n=structuredClone(old);n.meta.pendingOracle!.receipt={hash:receipt.hash,explorerUrl:receipt.explorerUrl};n.state.revision++;return n;});
  }catch{/* An unknown network result never becomes permission to issue a second nonce. */}
  await this.reconcile(accountId);
 }
 async retry(accountId:string){await this.reconcile(accountId);await this.broadcast(accountId);return this.session(accountId);}
 async quote(accountId:string,place:PlaceId,resource:Resource,quantity:number,side:'buy'|'sell'){
  assert(Number.isInteger(quantity)&&quantity>0&&quantity<=40,'Choose a quantity from 1 to 40.');assert(MERCHANT_GOODS[place]?.includes(resource),'This business does not trade that resource.');
  const [totalYocto,unitYocto]=await Promise.all([this.gateway.quote(place,resource,quantity,side==='buy'),this.gateway.quote(place,resource,1,side==='buy')]);
  return{unitPrice:nearAmount(unitYocto),total:nearAmount(totalYocto),totalYocto,reason:'Live contract quote · price changes with stock'};
 }
 async action(accountId:string,action:GameAction,requestId:string):Promise<{state:GameState;chainAction?:ChainAction}>{
  const key=this.key(accountId);let saved=await this.store.get(key);assert(saved?.state.mode==='live','Open your chain world first.',409);
  if(saved!.meta.pendingOracle){await this.reconcile(accountId);saved=await this.store.get(key);assert(!saved!.meta.pendingOracle,'A previous resource transaction is awaiting confirmation. Use Check transaction before continuing.',409);}
  if(saved!.meta.requests.some(r=>r.id===requestId)||saved!.meta.oracleReceipts?.[requestId])return{state:saved!.state};
  if(['move','enterVehicle','exitVehicle','survey','rest','scanner','toggleDoor'].includes(action.type)){
   const result=await this.store.mutate(key,old=>{
    assert(!old.meta.pendingOracle,'A resource transaction is pending.',409);if(old.meta.requests.some(r=>r.id===requestId))return old;
    let n:SavedGame;
    if(action.type==='scanner'){
     requireNear(old.state,'depot');assert(!old.state.player.scanner,'Your scanner is already equipped.');n=structuredClone(old);n.state.player.scanner=true;n.state.revision++;note(n.state,'Borrowed a survey scanner from the depot.');
    }else{const draft=structuredClone(old);draft.state.mode='demo';n=applyAction(draft,action);n.state.mode='live';}
    n.meta.requests=n.meta.requests.slice(-255);n.meta.requests.push({id:requestId,at:Date.now()});return n;
   });return{state:result.state};
  }
  assert(action.type!=='advance','Chain time cannot be fast-forwarded. Use the practice world for simulations.');
  const economy=await this.gateway.read(accountId);
  saved=await this.store.mutate(key,old=>{const n=projectChainState(old,accountId,economy);n.state.revision++;return n;});
  const state=saved.state,p=state.player;
  if(action.type==='gather'||action.type==='refuel'){
   const nonce=economy.player!.harvest_nonce+1;assert(Number.isSafeInteger(nonce),'The oracle nonce cannot be represented safely.');
   await this.store.mutate(key,old=>{
    assert(!old.meta.pendingOracle,'A resource transaction is already pending.',409);if(old.meta.requests.some(r=>r.id===requestId)||old.meta.oracleReceipts?.[requestId])return old;
    assert(nonce===(old.meta.confirmedOracleNonce??0)+1,'The chain changed while this action was prepared. Refresh and try again.',409);
    const draft=structuredClone(old);draft.state.mode='demo';
    if(action.type==='refuel')assert(draft.state.player.inventory.petrol>=1,'Buy a can of petrol first. Refuelling consumes one can on-chain.');
    const after=applyAction(draft,action);after.state.mode='live';const resource=action.type==='gather'?action.resource:'crude';
    const amount=action.type==='gather'?after.state.player.inventory[resource]-old.state.player.inventory[resource]:1;
    if(action.type==='gather'){const today=Math.floor(Date.now()/86400000);const already=Object.values(old.meta.oracleReceipts??{}).filter(r=>r.kind==='harvest'&&Math.floor(r.at/86400000)===today).reduce((n,r)=>n+(r.amount??0),0);assert(already+amount<=100,'You have reached today’s extraction limit. Return tomorrow.');}
    const n=structuredClone(old);n.meta.pendingOracle={nonce,kind:action.type==='gather'?'harvest':'fuel',resource,amount,createdAt:Date.now(),attempts:0,lastAttemptAt:0,after:after.state,lastGatherAt:after.meta.lastGatherAt,requestId};n.state.live!.pendingOracle=true;n.state.revision++;return n;
   });
   await this.broadcast(accountId);const completed=await this.store.get(key);
   assert(!completed!.meta.pendingOracle,'Your resource transaction is awaiting final confirmation. Use Check transaction before trying again.',409);
   return{state:completed!.state};
  }
  let transaction:ChainAction;
  if(action.type==='trade'){
   requireNear(state,action.merchant);assert(MERCHANT_GOODS[action.merchant]?.includes(action.resource),'This business does not trade that resource.');
   const merchant=state.merchants.find(m=>m.id===action.merchant)!;const quote=await this.quote(accountId,action.merchant,action.resource,action.quantity,action.side);
   if(action.side==='sell'){assert(p.inventory[action.resource]>=action.quantity,'You do not have enough cargo.');const account=economy.merchants.find(m=>m.place===action.merchant)!.account!;assert(BigInt(account.balance)>=BigInt(quote.totalYocto),'The merchant cannot afford this load.');}
   else{assert(merchant.stock[action.resource]>=action.quantity,'This business does not have enough stock.');assert(BigInt(economy.player!.balance)>=BigInt(quote.totalYocto),'Your game account needs more NEAR.');const limit=p.driving||distance(p.position,state.truckPosition??TRUCK_POSITION)<=12?40:12;assert(Object.values(p.inventory).reduce((a,b)=>a+b,0)+action.quantity<=limit,'There is not enough cargo space.');}
   transaction={method:'trade',args:{merchant_id:this.gateway.merchants()[action.merchant]!,token_id:action.resource,amount:String(action.quantity),buy:action.side==='buy',limit:quote.totalYocto},deposit:'1',...(action.side==='buy'?{costYocto:quote.totalYocto}:{receiveYocto:quote.totalYocto}),label:`${action.side==='buy'?'Buy':'Sell'} ${action.quantity} ${RESOURCE_NAMES[action.resource].toLowerCase()} for ${quote.total} NEAR`};
  }else if(action.type==='process'){
   const recipe=RECIPES[action.resource];assert(action.quantity>0&&action.quantity%2===0,'Processing needs 2 raw materials per batch.');assert(p.inventory[action.resource]>=action.quantity,'You do not have enough raw material.');const batches=action.quantity/2;
   if(p.facility&&isNear(state,'plot')){assert(action.resource==='crude','Your chain refinery processes crude oil only.');transaction={method:'refine_owned',args:{batches},deposit:'1',label:`Refine ${action.quantity} crude oil into ${batches} petrol · no service fee`};}
   else{requireNear(state,recipe.place);assert(BigInt(economy.player!.balance)>=UNIT*BigInt(batches),'Your game account needs more NEAR for processing.');transaction={method:'process',args:{merchant_id:this.gateway.merchants()[recipe.place]!,token_id:action.resource,batches},deposit:'1',costYocto:(UNIT*BigInt(batches)).toString(),label:`Process ${action.quantity} ${RESOURCE_NAMES[action.resource].toLowerCase()} · ${(batches*.001).toFixed(3)} NEAR service fee`};}
  }else if(action.type==='build'){
   requireNear(state,'plot');assert(!p.facility,'Your refinery is already built.');assert(p.inventory.steel>=10&&p.inventory.planks>=10,'Building needs 10 steel and 10 planks.');transaction={method:'build_refinery',args:{},deposit:'1',label:'Build your refinery · consumes 10 steel and 10 planks'};
  }else throw new GameError('This chain action is not supported.');
  transaction.receiverId=process.env.NEAR_CONTRACT_ID;return{state,chainAction:transaction};
 }
}

export function createLiveRouter(store:GameStore){
 const router=Router(),service=new LiveGameService(store);
 router.use(async(_req,res,next)=>{try{await assertMainnetReady();next();}catch{res.status(503).json({error:'Worldo’s NEAR world is not available yet.'});}});
 const identity=(req:Request)=>{assert(chain.gameChainConfigured(),'Chain gameplay requires configured Auth, contract, oracle, merchants and Neon.',503);const i=getVerifiedIdentity(req);assert(i,'Sign in with NEAR Auth before entering chain.',401);return i!;};
 router.get('/session',async(req,res,next)=>{try{res.json(await service.session(identity(req).accountId));}catch(e){next(e);}});
 router.post('/quote',async(req,res,next)=>{try{const id=identity(req);const parsed=actionSchema.safeParse({...req.body,type:'trade'});assert(parsed.success&&parsed.data.type==='trade','Invalid quote request.');const a=parsed.data as Extract<GameAction,{type:'trade'}>;res.json(await service.quote(id.accountId,a.merchant,a.resource,a.quantity,a.side));}catch(e){next(e);}});
 router.post('/action',async(req,res,next)=>{try{const id=identity(req);const parsed=actionSchema.safeParse(req.body);assert(parsed.success,'Invalid chain action.');const requestId=req.get('x-request-id');assert(requestId&&/^[a-zA-Z0-9_-]{8,100}$/.test(requestId),'A unique request identifier is required.');res.json(await service.action(id.accountId,parsed.data!,requestId!));}catch(e){next(e);}});
 router.post('/retry',async(req,res,next)=>{try{res.json(await service.retry(identity(req).accountId));}catch(e){next(e);}});
 return router;
}
