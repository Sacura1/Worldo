import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {applyAction,newGame,type SavedGame} from '../server/economy';
import {GameStore} from '../server/store';
import {PLACES,type PlaceId} from '../shared/types';
import {quoteTrade} from '../shared/economy-rules';

const at=(g:SavedGame,id:PlaceId)=>{g.state.player.position={...PLACES.find(p=>p.id===id)!.position};return g;};
const wealth=(g:SavedGame)=>Math.round((g.state.player.balance+g.state.merchants.reduce((sum,m)=>sum+m.budget,0))*100);
describe('authoritative economy',()=>{
 it('starts an explicitly isolated practice world with finite merchant budgets',()=>{const a=newGame(),b=newGame();expect(a.state.mode).toBe('demo');expect(a.state.player.balance).toBe(120);a.state.merchants[0].budget=0;expect(b.state.merchants[0].budget).toBe(300);});
 it('rejects teleporting and client vehicle switching',()=>{const g=newGame('test',1000);expect(()=>applyAction(g,{type:'move',x:80,z:80,heading:0,driving:false},1200)).toThrow('too fast');expect(()=>applyAction(g,{type:'move',x:0,z:23,heading:0,driving:true},1200)).toThrow('Enter or exit');expect(g.state.revision).toBe(0);});
 it('allows normal walking and heading updates',()=>{const g=newGame('test',1000);const n=applyAction(g,{type:'move',x:0,z:22,heading:1,driving:false},1200);expect(n.state.player.position.z).toBe(22);expect(n.state.player.heading).toBe(1);});
 it('allows recovery movement when received resources exceed carrying capacity',()=>{const g=newGame('test',1000);g.state.player.inventory.steel=100;g.state.truckPosition={x:80,z:80};const n=applyAction(g,{type:'move',x:0,z:22,heading:0,driving:false},1200);expect(n.state.player.position.z).toBe(22);expect(n.state.player.inventory.steel).toBe(100);});
 it('prevents movement bursts from repeatedly spending the same allowance',()=>{let g=newGame('test',1000);g=applyAction(g,{type:'move',x:0,z:20,heading:0,driving:false},1200);expect(()=>applyAction(g,{type:'move',x:0,z:17,heading:0,driving:false},1200)).toThrow('too fast');});
 it('requires proximity and scanner before drilling',()=>{let g=at(newGame(),'oilfield');expect(()=>applyAction(g,{type:'gather',resource:'crude'})).toThrow('scanner');g=at(g,'depot');g=applyAction(g,{type:'scanner'});g.state.player.position={...g.meta.oilDeposit!};g=applyAction(g,{type:'survey'},10000);g=applyAction(g,{type:'gather',resource:'crude'},13000);expect(g.state.player.inventory.crude).toBe(2);expect(g.state.deposits!.crude).toBe(78);expect(g.state.player.energy).toBe(91);});
 it('keeps the deposit private until a close survey and gives useful search signals',()=>{
  let g=at(newGame(),'oilfield');g.state.player.scanner=true;
  const deposit={...g.meta.oilDeposit!};expect(Math.hypot(deposit.x-25,deposit.z+65)).toBeGreaterThan(8);
  g=applyAction(g,{type:'survey'},10000);expect(g.state.player.discovered).toBe(false);expect(g.state.player.depositPosition).toBeUndefined();expect(g.state.player.scanSignal).toBeGreaterThan(0);expect(g.state.player.scanSignal).toBeLessThan(100);expect(g.state.player.scanHint).toMatch(/^Move /);
  const previous=g.state.player.scanSignal!;g.state.player.position={x:(25+deposit.x)/2,z:(-65+deposit.z)/2};g=applyAction(g,{type:'survey'},13000);expect(g.state.player.scanSignal).toBeGreaterThan(previous);
  g.state.player.position={...deposit};g=applyAction(g,{type:'survey'},16000);expect(g.state.player.depositPosition).toEqual(deposit);expect(g.state.player.scanSignal).toBe(100);expect(g.meta.oilDeposit).toEqual(deposit);
  g.state.player.position={x:25,z:-65};expect(()=>applyAction(g,{type:'gather',resource:'crude'},20000)).toThrow('drilling marker');
 });
 it('limits extraction by time, energy, remaining deposit and carry capacity',()=>{let g=at(newGame(),'forest');g=applyAction(g,{type:'gather',resource:'timber'},10000);expect(()=>applyAction(g,{type:'gather',resource:'timber'},11000)).toThrow('still working');g.state.player.inventory.timber=12;expect(()=>applyAction(g,{type:'gather',resource:'timber'},14000)).toThrow('full');g.state.player.inventory.timber=0;g.state.deposits!.timber=0;expect(()=>applyAction(g,{type:'gather',resource:'timber'},14000)).toThrow('exhausted');});
 it('requires a nearby truck to use its cargo capacity',()=>{const g=at(newGame(),'forest');g.state.player.inventory.timber=12;g.state.truckPosition={...g.state.player.position};const next=applyAction(g,{type:'gather',resource:'timber'},10000);expect(next.state.player.inventory.timber).toBe(14);next.meta.moveCredit=30;next.meta.lastMoveAt=10000;expect(()=>applyAction(next,{type:'move',x:-45,z:-55,heading:0,driving:false},12000)).toThrow('too fast');});
 it('conserves credits in trading and lowers price as supply increases',()=>{let g=at(newGame(),'refinery');g.state.player.inventory.crude=10;const before=wealth(g),price=quoteTrade(g.state,'refinery','crude',1,'sell').total;g=applyAction(g,{type:'trade',merchant:'refinery',resource:'crude',quantity:10,side:'sell'});expect(wealth(g)).toBe(before);expect(quoteTrade(g.state,'refinery','crude',1,'sell').total).toBeLessThan(price);expect(g.state.player.inventory.crude).toBe(0);});
 it('cannot profit by immediately selling bought goods back',()=>{let g=at(newGame(),'depot');const before=g.state.player.balance;g=applyAction(g,{type:'trade',merchant:'depot',resource:'petrol',quantity:2,side:'buy'});g=applyAction(g,{type:'trade',merchant:'depot',resource:'petrol',quantity:2,side:'sell'});expect(g.state.player.balance).toBeLessThan(before);});
 it('rejects insufficient merchant funds atomically',()=>{const g=at(newGame(),'refinery');g.state.player.inventory.crude=4;g.state.merchants[1].budget=0;expect(()=>applyAction(g,{type:'trade',merchant:'refinery',resource:'crude',quantity:4,side:'sell'})).toThrow('cannot afford');expect(g.state.player.inventory.crude).toBe(4);});
 it('rejects malformed quantities and unsupported goods',()=>{const g=at(newGame(),'refinery');expect(()=>applyAction(g,{type:'trade',merchant:'refinery',resource:'crude',quantity:-4,side:'sell'})).toThrow('quantity');expect(()=>applyAction(g,{type:'trade',merchant:'refinery',resource:'timber',quantity:1,side:'buy'})).toThrow('does not trade');});
 it('processing consumes raw material, transfers a service fee and creates output',()=>{const g=at(newGame(),'refinery');g.state.player.inventory.crude=4;const before=wealth(g);const n=applyAction(g,{type:'process',resource:'crude',quantity:4});expect(n.state.player.inventory.crude).toBe(0);expect(n.state.player.inventory.petrol).toBe(2);expect(n.state.player.balance).toBe(116);expect(wealth(n)).toBe(before);});
 it('construction consumes materials, conserves credits and permits own production',()=>{let g=at(newGame(),'plot');g.state.player.inventory.steel=4;g.state.player.inventory.planks=6;const before=wealth(g);g=applyAction(g,{type:'build'});expect(g.state.player.facility).toBe(true);expect(g.state.player.inventory.steel).toBe(0);expect(g.state.player.inventory.planks).toBe(0);expect(g.state.player.balance).toBe(60);expect(wealth(g)).toBe(before);expect(g.state.production!.materialsUsed).toBe(10);g.state.player.inventory.ore=2;g=applyAction(g,{type:'process',resource:'ore',quantity:2});expect(g.state.player.inventory.steel).toBe(1);expect(g.state.player.balance).toBe(60);});
 it.each([
  {steel:3,planks:6,balance:60,facility:false,error:'Building needs'},
  {steel:4,planks:5,balance:60,facility:false,error:'Building needs'},
  {steel:4,planks:6,balance:59,facility:false,error:'enough credits'},
  {steel:4,planks:6,balance:60,facility:true,error:'already built'}
 ])('rejects invalid construction atomically: $error ($steel steel, $planks planks)',({steel,planks,balance,facility,error})=>{const g=at(newGame(),'plot');Object.assign(g.state.player,{balance,facility});Object.assign(g.state.player.inventory,{steel,planks});const before=structuredClone(g);expect(()=>applyAction(g,{type:'build'})).toThrow(error);expect(g).toEqual(before);});
 it('owned production processes every recipe without creating or charging credits',()=>{let g=at(newGame(),'plot');g.state.player.facility=true;g.state.player.balance=0;Object.assign(g.state.player.inventory,{crude:2,ore:2,timber:2});const before=wealth(g);for(const resource of ['crude','ore','timber'] as const)g=applyAction(g,{type:'process',resource,quantity:2});expect(g.state.player.inventory).toEqual({crude:0,ore:0,timber:0,petrol:1,steel:1,planks:1});expect(g.state.player.balance).toBe(0);expect(wealth(g)).toBe(before);});
 it('ownership does not waive another business processing fee',()=>{const g=at(newGame(),'refinery');g.state.player.facility=true;g.state.player.balance=0;g.state.player.inventory.crude=2;expect(()=>applyAction(g,{type:'process',resource:'crude',quantity:2})).toThrow('enough credits');expect(g.state.player.inventory.crude).toBe(2);});
 it('town simulation consumes supplies without minting cash',()=>{const g=newGame();const before=wealth(g);const n=applyAction(g,{type:'advance'},10000);expect(wealth(n)).toBe(before);expect(n.state.production!.fuelConsumed).toBe(2);expect(n.state.production!.materialsUsed).toBe(2);expect(n.state.day).toBe(2);});
 it('permits empty-fuel recovery on foot and free rest',()=>{let g=newGame();g.state.player.driving=true;g.state.player.fuel=0;g=applyAction(g,{type:'exitVehicle'});expect(g.state.player.driving).toBe(false);g=at(g,'depot');g.state.player.energy=0;g=applyAction(g,{type:'rest'});expect(g.state.player.energy).toBe(100);});
});

describe('persistent concurrency',()=>{
 it('atomically applies concurrent trades without overselling or losing cash',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lowland-store-'));try{
   const store=new GameStore(dir,undefined),id='a'.repeat(64);await store.create(id);
   await store.mutate(id,old=>{const n=structuredClone(old);at(n,'refinery');n.state.player.inventory.crude=2;n.state.revision++;return n;});
   const results=await Promise.allSettled([1,2].map(()=>store.mutate(id,old=>applyAction(old,{type:'trade',merchant:'refinery',resource:'crude',quantity:2,side:'sell'}))));
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await store.get(id))!.state.player.inventory.crude).toBe(0);
   const anotherStore=new GameStore(dir,undefined);expect((await anotherStore.get(id))!.state.player.inventory.crude).toBe(0);
  }finally{if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep))await rm(dir,{recursive:true,force:true});}
 });
});
