import {randomUUID,createHash} from 'node:crypto';
import {PLACES,RESOURCE_NAMES,START_POSITION,TRUCK_POSITION,emptyInventory,type GameState,type GameAction,type PlaceId,type Resource,type Vec2} from '../shared/types';
import {BUILD_COST,RECIPES,SCANNER_COST,cargoUsed,capacity,quoteTrade,roundMoney} from '../shared/economy-rules';

export {quoteTrade} from '../shared/economy-rules';
export interface OracleCommand {nonce:number;kind:'harvest'|'fuel';resource:'crude'|'ore'|'timber';amount:number;createdAt:number;attempts:number;lastAttemptAt:number;after:GameState;lastGatherAt:number;requestId:string;receipt?:{hash:string;explorerUrl:string};}
export interface GameMeta {lastMoveAt:number;lastGatherAt:number;lastSurveyAt:number;lastAdvanceAt:number;moveCredit:number;requests:{id:string;at:number}[];pendingOracle?:OracleCommand;confirmedOracleNonce?:number;oracleReceipts?:Record<string,{nonce:number;at:number;hash?:string;kind?:'harvest'|'fuel';amount?:number}>;liveDay?:number;oilDeposit?:Vec2;}
export interface SavedGame {state:GameState;meta:GameMeta;}
export class GameError extends Error {constructor(message:string,public status=400){super(message);}}
const distance=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.z-b.z);
const expect=(condition:unknown,message:string)=>{if(!condition)throw new GameError(message);};
const near=(state:GameState,id:PlaceId,radius=10)=>distance(state.player.position,PLACES.find(p=>p.id===id)!.position)<=radius;
const requireNear=(state:GameState,id:PlaceId)=>expect(near(state,id),`Move closer to ${PLACES.find(p=>p.id===id)!.name}.`);
const integer=(n:number)=>Number.isInteger(n)&&n>0&&n<=40;
function log(state:GameState,text:string,at:number){state.activities.unshift({id:randomUUID(),text,at});state.activities=state.activities.slice(0,30);}
function spend(state:GameState,amount:number){expect(state.player.balance>=amount,'You do not have enough credits.');state.player.balance=roundMoney(state.player.balance-amount);}
function budget(state:GameState,id:PlaceId,amount:number){const m=state.merchants.find(m=>m.id===id);if(m)m.budget=roundMoney(m.budget+amount);}
function createOilDeposit(privateSeed:string):Vec2 {
 const bytes=createHash('sha256').update(privateSeed).digest(),angle=bytes[0]/255*Math.PI*2,radius=10+bytes[1]/255*6;
 const centre=PLACES.find(p=>p.id==='oilfield')!.position;
 return{x:Math.round(centre.x+Math.sin(angle)*radius),z:Math.round(centre.z-Math.cos(angle)*radius)};
}
function prospectHint(from:Vec2,to:Vec2):string {
 const directions=['north','northeast','east','southeast','south','southwest','west','northwest'];
 const angle=Math.atan2(to.x-from.x,from.z-to.z);
 return `Move ${directions[(Math.round(angle/(Math.PI/4))+8)%8]} and scan again.`;
}

export function newGame(id:string=randomUUID(),now=Date.now()):SavedGame {
 const state:GameState={mode:'demo',day:1,revision:0,player:{id,name:'New arrival',position:{...START_POSITION},heading:0,driving:false,fuel:70,energy:100,scanner:false,balance:120,inventory:emptyInventory(),facility:false,discovered:false,xp:0},truckPosition:{...TRUCK_POSITION},deposits:{crude:80,ore:100,timber:100},production:{fuelConsumed:0,materialsUsed:0},merchants:[
 {id:'depot',name:'Supply depot',budget:300,stock:{...emptyInventory(),petrol:12,steel:10,planks:12}},
 {id:'refinery',name:'Lowland Refinery',budget:180,stock:{...emptyInventory(),crude:8,petrol:16}},
 {id:'sawmill',name:'Pine & Co. Sawmill',budget:160,stock:{...emptyInventory(),timber:10,planks:16}},
 {id:'foundry',name:'Eastbank Foundry',budget:200,stock:{...emptyInventory(),ore:12,steel:14}}],activities:[]};
 log(state,'Welcome to Lowland. Your pickup is parked outside the supply depot.',now);
 return {state,meta:{lastMoveAt:now,lastGatherAt:0,lastSurveyAt:0,lastAdvanceAt:0,moveCredit:2,requests:[],oilDeposit:createOilDeposit(randomUUID())}};
}

export function applyAction(saved:SavedGame,action:GameAction,now=Date.now()):SavedGame {
 const next=structuredClone(saved),s=next.state,p=s.player,meta=next.meta;
 // The private coordinate is never returned by the API. Existing saves migrate
 // on their next successful action, then retain the same deposit across restarts.
 if(!meta.oilDeposit)meta.oilDeposit=createOilDeposit(randomUUID());
 if(p.discovered&&!p.depositPosition)p.discovered=false;
 expect(s.mode==='demo','Live settlement is not enabled for this session.');
 switch(action.type){
 case 'move':{
  expect([action.x,action.z,action.heading].every(Number.isFinite),'Invalid position.');
  expect(Math.abs(action.x)<=100&&Math.abs(action.z)<=100,'You have reached the edge of Lowland.');
  expect(action.driving===p.driving,'Enter or exit the pickup first.');
  const elapsed=Math.max(0,Math.min(2000,now-meta.lastMoveAt))/1000;
  const speed=p.driving?13.2:6.2;
  const allowed=Math.min(speed*2+2,meta.moveCredit+elapsed*speed);
  const travel=distance(p.position,{x:action.x,z:action.z});
  expect(travel<=allowed+.1,'Movement was too fast. Your position has been restored.');
  // A received on-chain transfer may exceed the normal carry allowance. Limit
  // new gathering and purchases, but never trap someone away from a business.
  if(p.driving&&travel>.02){expect(p.fuel>0,'The tank is empty. Exit the pickup to fetch fuel.');p.fuel=Math.max(0,p.fuel-travel*.075);s.truckPosition={x:action.x,z:action.z};}
  p.position={x:action.x,z:action.z};p.heading=action.heading;meta.moveCredit=Math.max(0,allowed-travel);meta.lastMoveAt=now;
  break;
 }
 case 'enterVehicle':
  expect(!p.driving,'You are already driving.');expect(distance(p.position,s.truckPosition??TRUCK_POSITION)<=6,'Move closer to your pickup.');p.driving=true;p.position={...(s.truckPosition??TRUCK_POSITION)};meta.lastMoveAt=now;meta.moveCredit=2;break;
 case 'exitVehicle':
  expect(p.driving,'You are already on foot.');p.driving=false;s.truckPosition={...p.position};p.position={x:Math.min(98,p.position.x+2),z:p.position.z};meta.lastMoveAt=now;meta.moveCredit=2;break;
 case 'scanner':
  requireNear(s,'depot');expect(!p.scanner,'You already own a scanner.');spend(s,SCANNER_COST);budget(s,'depot',SCANNER_COST);p.scanner=true;log(s,'Bought a survey scanner. Search North ridge for an oil deposit.',now);break;
 case 'survey':{
  expect(p.scanner,'Buy a scanner at the supply depot first.');expect(!p.driving,'Step out of the pickup to survey.');expect(now-meta.lastSurveyAt>=1800,'The scanner is still taking a reading.');expect(p.energy>=3,'Rest at the supply depot to recover energy.');p.energy-=3;meta.lastSurveyAt=now;
  const deposit=meta.oilDeposit!,range=distance(p.position,deposit);
  p.scanSignal=range<=4.5?100:Math.max(0,Math.round(100-(range-4.5)*3.8));
  if(range<=4.5){p.discovered=true;p.depositPosition={...deposit};p.scanHint='Deposit located. Work within 5 metres of the marked ground.';log(s,'Oil deposit located. A drilling marker has been added to your map.',now);}
  else{p.scanHint=p.scanSignal>0?prospectHint(p.position,deposit):'No signal. Search the North ridge region.';log(s,`Scanner signal ${p.scanSignal}%. ${p.scanHint}`,now);}
  break;
 }
 case 'gather':{
  expect(!p.driving,'Step out of the pickup to gather resources.');
  const location={crude:'oilfield',ore:'quarry',timber:'forest'}[action.resource] as PlaceId;expect(!!location,'Unknown resource.');
  if(action.resource==='crude'){
   expect(p.scanner&&p.discovered&&p.depositPosition,'Survey this oil deposit with your scanner first.');
   expect(distance(p.position,meta.oilDeposit!)<=5.5,'Move closer to the discovered drilling marker before extracting oil.');
  }else requireNear(s,location);
  expect(now-meta.lastGatherAt>=3000,'Your equipment is still working. Try again in a moment.');expect(p.energy>=6,'You need more energy. Rest at the depot.');
  const remaining=s.deposits??{crude:80,ore:100,timber:100};expect(remaining[action.resource]>0,'This deposit is exhausted for today.');
  // Cargo is stored in the nearby truck when it is within reach, so gathering remains on foot.
  const max=distance(p.position,s.truckPosition??TRUCK_POSITION)<=12?40:12;
  const amount=Math.min(2,max-cargoUsed(s),remaining[action.resource]);expect(amount>0,'Your cargo is full. Sell or process a load first.');
  p.inventory[action.resource]+=amount;remaining[action.resource]-=amount;s.deposits=remaining;p.energy-=6;p.xp+=amount;meta.lastGatherAt=now;log(s,`Collected ${amount} ${RESOURCE_NAMES[action.resource].toLowerCase()}.`,now);break;
 }
 case 'trade':{
  expect(integer(action.quantity),'Choose a quantity from 1 to 40.');expect(action.side==='buy'||action.side==='sell','Invalid trade side.');requireNear(s,action.merchant);
  const m=s.merchants.find(m=>m.id===action.merchant);expect(!!m,'This business is closed.');const q=quoteTrade(s,action.merchant,action.resource,action.quantity,action.side);
  if(action.side==='sell'){expect(p.inventory[action.resource]>=action.quantity,'You do not have that much cargo.');expect(m!.budget>=q.total,'This merchant cannot afford this load. Try a smaller quantity.');p.inventory[action.resource]-=action.quantity;m!.stock[action.resource]+=action.quantity;m!.budget=roundMoney(m!.budget-q.total);p.balance=roundMoney(p.balance+q.total);}
  else{expect(m!.stock[action.resource]>=action.quantity,'This business does not have enough stock.');const max=p.driving||distance(p.position,s.truckPosition??TRUCK_POSITION)<=12?40:capacity(s);expect(cargoUsed(s)+action.quantity<=max,'There is not enough cargo space.');spend(s,q.total);p.inventory[action.resource]+=action.quantity;m!.stock[action.resource]-=action.quantity;m!.budget=roundMoney(m!.budget+q.total);}
  log(s,`${action.side==='sell'?'Sold':'Bought'} ${action.quantity} ${RESOURCE_NAMES[action.resource].toLowerCase()} for ${q.total.toFixed(2)} credits.`,now);p.xp+=action.quantity;break;
 }
 case 'process':{
  expect(integer(action.quantity)&&action.quantity%2===0,'Processing takes an even number of raw materials (2 per batch).');const recipe=RECIPES[action.resource];expect(!!recipe,'That resource cannot be processed.');
  const own=p.facility&&near(s,'plot');expect(own||near(s,recipe.place),`Visit ${PLACES.find(place=>place.id===recipe.place)!.name} to process this material.`);
  expect(p.inventory[action.resource]>=action.quantity,'You do not have enough raw material.');const output=action.quantity/recipe.input;const fee=own?0:output*recipe.fee;spend(s,fee);if(!own)budget(s,recipe.place,fee);p.inventory[action.resource]-=action.quantity;p.inventory[recipe.output]+=output;p.xp+=output*2;log(s,`Processed ${action.quantity} ${RESOURCE_NAMES[action.resource].toLowerCase()} into ${output} ${RESOURCE_NAMES[recipe.output].toLowerCase()}.`,now);break;
 }
 case 'refuel':{
  expect(distance(p.position,s.truckPosition??TRUCK_POSITION)<=12,'Move closer to your pickup.');expect(p.fuel<99,'Your fuel tank is already full.');
  if(p.inventory.petrol>=1){p.inventory.petrol--;p.fuel=Math.min(100,p.fuel+25);}
  else{const m=s.merchants.find(m=>(m.id==='depot'||m.id==='refinery')&&near(s,m.id)&&m.stock.petrol>0);expect(!!m,'Bring a can of petrol or park beside a fuel seller.');const quote=quoteTrade(s,m!.id,'petrol',1,'buy');spend(s,quote.total);m!.stock.petrol--;m!.budget=roundMoney(m!.budget+quote.total);p.fuel=Math.min(100,p.fuel+25);}
  s.production??={fuelConsumed:0,materialsUsed:0};s.production.fuelConsumed++;log(s,'Refuelled the pickup (+25 fuel).',now);break;
 }
 case 'rest':
  requireNear(s,'depot');expect(!p.driving,'Step out of the pickup to rest.');p.energy=100;log(s,'Rested at the depot. Energy restored.',now);break;
 case 'build':{
  requireNear(s,'plot');expect(!p.facility,'Your workshop is already built.');expect(p.inventory.steel>=BUILD_COST.steel&&p.inventory.planks>=BUILD_COST.planks,'Building needs 4 steel beams and 6 bundles of planks.');spend(s,BUILD_COST.credits);budget(s,'depot',BUILD_COST.credits);p.inventory.steel-=BUILD_COST.steel;p.inventory.planks-=BUILD_COST.planks;p.facility=true;p.xp+=50;s.production??={fuelConsumed:0,materialsUsed:0};s.production.materialsUsed+=10;log(s,'Your Riverside workshop is open. Process your own materials here without service fees.',now);break;
 }
 case 'advance':{
  expect(now-meta.lastAdvanceAt>=2000,'The town is still settling its last orders.');meta.lastAdvanceAt=now;s.day++;
  s.production??={fuelConsumed:0,materialsUsed:0};
  // Merchants use finite stocks. Processing conserves cash; it never mints credits.
  for(const raw of ['crude','ore','timber'] as const){const recipe=RECIPES[raw],m=s.merchants.find(m=>m.id===recipe.place)!;const batches=Math.min(3,Math.floor(m.stock[raw]/2));m.stock[raw]-=batches*2;m.stock[recipe.output]+=batches;}
  const depot=s.merchants.find(m=>m.id==='depot')!;
  for(const item of ['petrol','steel','planks'] as const){const producer=s.merchants.find(m=>m.id===({petrol:'refinery',steel:'foundry',planks:'sawmill'} as const)[item])!;for(let i=0;i<2&&depot.stock[item]<12&&producer.stock[item]>0;i++){const price=quoteTrade(s,producer.id,item,1,'buy').total;if(depot.budget<price)break;depot.budget=roundMoney(depot.budget-price);producer.budget=roundMoney(producer.budget+price);producer.stock[item]--;depot.stock[item]++;}}
  const fuel=Math.min(2,depot.stock.petrol);depot.stock.petrol-=fuel;s.production.fuelConsumed+=fuel;
  for(const item of ['steel','planks'] as const){const count=Math.min(1,depot.stock[item]);depot.stock[item]-=count;s.production.materialsUsed+=count;}
  s.deposits={crude:Math.min(80,(s.deposits?.crude??0)+12),ore:Math.min(100,(s.deposits?.ore??0)+16),timber:Math.min(100,(s.deposits?.timber??0)+16)};
  log(s,`Day ${s.day}: businesses processed stock, purchased supplies and used ${fuel} cans of fuel.`,now);break;
 }
 default:throw new GameError('Unknown action.');
 }
 s.revision++;return next;
}
