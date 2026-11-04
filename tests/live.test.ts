import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {GameStore} from '../server/store';
import {LiveGameService,type LiveGateway} from '../server/live';
import type {LiveAccount} from '../server/game-chain';
import {PLACES,type PlaceId} from '../shared/types';

const accountId='player.near';
const key=createHash('sha256').update(`lowland-mainnet-v1:${accountId}`).digest('hex');
// This suite deliberately models mainnet account IDs and journal keys. The
// product's default network may change without changing this fixture's domain.
beforeEach(()=>{vi.stubEnv('NEAR_NETWORK','mainnet');vi.stubEnv('NEAR_RPC_URL','');});
afterEach(()=>vi.unstubAllEnvs());
function gatewayFixture(){
 const player:LiveAccount={inventory:['0','0','0','0','0','0'],balance:'1000000000000000000000000',harvest_nonce:0,refinery:false};
 const accounts={depot:'depot.near',refinery:'refinery.near',sawmill:'sawmill.near',foundry:'foundry.near'};
 const merchants=Object.entries(accounts).map(([place,id])=>({place:place as PlaceId,accountId:id,account:{inventory:['20','20','20','20','20','20'],balance:'1000000000000000000000000',harvest_nonce:0,refinery:false}}));
 const economy={player,paused:false,merchants};
 const harvest=vi.fn(async(_id:string,resource:'crude'|'ore'|'timber',amount:number,nonce:number)=>{if(nonce!==player.harvest_nonce+1)throw new Error('Replay');player.harvest_nonce=nonce;const i={crude:0,ore:1,timber:2}[resource];player.inventory[i]=String(Number(player.inventory[i])+amount);return{hash:'receipt-01',explorerUrl:'https://nearblocks.io/txns/receipt-01',outcome:{status:{SuccessValue:''}}};});
 const fuel=vi.fn(async(_id:string,amount:number,nonce:number)=>{if(nonce!==player.harvest_nonce+1)throw new Error('Replay');player.harvest_nonce=nonce;player.inventory[3]=String(Number(player.inventory[3])-amount);return{hash:'fuel-01',explorerUrl:'https://nearblocks.io/txns/fuel-01',outcome:{status:{SuccessValue:''}}};});
 const gateway:LiveGateway={configured:()=>true,read:async()=>structuredClone(economy),quote:async()=> '2000000000000000000000',harvest,fuel,merchants:()=>accounts};
 return{gateway,player,economy,harvest,fuel};
}
async function fixture(){const directory=await mkdtemp(path.join(os.tmpdir(),'lowland-live-')),store=new GameStore(directory,''),chain=gatewayFixture(),service=new LiveGameService(store,chain.gateway);await service.session(accountId);return{directory,store,service,...chain};}
async function cleanup(directory:string){if(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))await rm(directory,{recursive:true,force:true});}
async function position(store:GameStore,place:PlaceId){await store.mutate(key,old=>{const n=structuredClone(old);n.state.player.position={...PLACES.find(p=>p.id===place)!.position};n.state.revision++;return n;});}

describe('mainnet game binding with mocked chain transport',()=>{
 it('uses chain balances and inventory instead of practice grants',async()=>{const f=await fixture();try{const state=await f.service.session(accountId);expect(state.mode).toBe('live');expect(state.player.balance).toBe(1);expect(state.player.inventory.crude).toBe(0);expect(state.live!.balanceYocto).toBe(f.player.balance);expect(state.live!.build).toEqual({steel:10,planks:10,credits:0});await expect(f.service.action(accountId,{type:'advance'},'advance-request')).rejects.toThrow('cannot be fast-forwarded');}finally{await cleanup(f.directory);}});
 it('reserves an oracle nonce before minting and prevents replay after movement IDs are evicted',async()=>{const f=await fixture();try{await position(f.store,'forest');const result=await f.service.action(accountId,{type:'gather',resource:'timber'},'harvest-request-01');expect(result.state.player.inventory.timber).toBe(2);expect(f.harvest).toHaveBeenCalledTimes(1);expect(result.state.live!.receipt!.hash).toBe('receipt-01');await f.store.mutate(key,old=>{const n=structuredClone(old);n.meta.requests=[];n.state.revision++;return n;});await f.service.action(accountId,{type:'gather',resource:'timber'},'harvest-request-01');expect(f.harvest).toHaveBeenCalledTimes(1);expect(f.player.harvest_nonce).toBe(1);}finally{await cleanup(f.directory);}});
 it('recovers a committed transaction after losing its HTTP response without minting twice',async()=>{const f=await fixture();try{await position(f.store,'forest');const original=f.gateway.harvest;f.gateway.harvest=async(...args)=>{await original(...args);throw new Error('Network response lost');};const result=await f.service.action(accountId,{type:'gather',resource:'timber'},'harvest-network-01');expect(result.state.player.inventory.timber).toBe(2);expect(result.state.live!.pendingOracle).toBe(false);expect(f.player.harvest_nonce).toBe(1);}finally{await cleanup(f.directory);}});
 it('keeps ambiguous commands pending and never fabricates resource awards',async()=>{const f=await fixture();try{await position(f.store,'forest');f.gateway.harvest=vi.fn(async()=>{throw new Error('Connection lost before result');});await expect(f.service.action(accountId,{type:'gather',resource:'timber'},'harvest-pending-01')).rejects.toThrow('awaiting final confirmation');const saved=await f.store.get(key);expect(saved!.state.player.inventory.timber).toBe(0);expect(saved!.meta.pendingOracle!.nonce).toBe(1);await expect(f.service.action(accountId,{type:'gather',resource:'timber'},'harvest-pending-02')).rejects.toThrow('awaiting confirmation');await f.service.retry(accountId);expect(f.gateway.harvest).toHaveBeenCalledTimes(1);}finally{await cleanup(f.directory);}});
 it('prepares a bounded trade without spending until user authorization',async()=>{const f=await fixture();try{await position(f.store,'refinery');f.player.inventory[0]='2';const result=await f.service.action(accountId,{type:'trade',merchant:'refinery',resource:'crude',quantity:2,side:'sell'},'sell-request-01');expect(result.chainAction).toMatchObject({method:'trade',deposit:'1',receiveYocto:'2000000000000000000000',args:{merchant_id:'refinery.near',amount:'2',buy:false,limit:'2000000000000000000000'}});expect(f.player.inventory[0]).toBe('2');expect(f.player.balance).toBe('1000000000000000000000000');}finally{await cleanup(f.directory);}});
 it('refuels only after the on-chain can is consumed',async()=>{const f=await fixture();try{f.player.inventory[3]='1';await f.store.mutate(key,old=>{const n=structuredClone(old);n.state.truckPosition={...n.state.player.position};n.state.revision++;return n;});const result=await f.service.action(accountId,{type:'refuel'},'fuel-request-01');expect(result.state.player.fuel).toBe(95);expect(result.state.player.inventory.petrol).toBe(0);expect(f.fuel).toHaveBeenCalledTimes(1);}finally{await cleanup(f.directory);}});

 it('prepares construction without spending and adopts ownership only from a finalized chain snapshot',async()=>{
  const f=await fixture();try{
   await position(f.store,'plot');f.player.inventory[4]='12';f.player.inventory[5]='11';f.player.balance='0';
   const prepared=await f.service.action(accountId,{type:'build'},'build-review-01');
   expect(prepared.chainAction).toMatchObject({method:'build_refinery',args:{},deposit:'1'});expect(prepared.chainAction?.costYocto).toBeUndefined();
   expect(prepared.state.player.facility).toBe(false);expect(prepared.state.player.inventory).toMatchObject({steel:12,planks:11});expect(prepared.state.live!.balanceYocto).toBe('0');
   expect(f.player.refinery).toBe(false);expect(f.player.inventory.slice(4)).toEqual(['12','11']);expect(f.harvest).not.toHaveBeenCalled();expect(f.fuel).not.toHaveBeenCalled();
   // This is the mocked FINAL read after an independently authorized transaction,
   // not an optimistic award made by preparing the unsigned build action.
   f.player.inventory[4]='2';f.player.inventory[5]='1';f.player.refinery=true;
   const confirmed=await f.service.session(accountId);expect(confirmed.player.facility).toBe(true);expect(confirmed.player.inventory).toMatchObject({steel:2,planks:1});expect(confirmed.live!.balanceYocto).toBe('0');
   await expect(f.service.action(accountId,{type:'build'},'build-duplicate-01')).rejects.toThrow('already built');
  }finally{await cleanup(f.directory);}
 });

 it.each([['9','10'],['10','9']])('rejects construction from finalized inventory with %s steel and %s planks',async(steel,planks)=>{
  const f=await fixture();try{
   await position(f.store,'plot');f.player.inventory[4]=steel;f.player.inventory[5]=planks;
   // A stale or locally modified saved inventory cannot satisfy chain prerequisites.
   await f.store.mutate(key,old=>{const next=structuredClone(old);next.state.player.inventory.steel=100;next.state.player.inventory.planks=100;next.state.revision++;return next;});
   await expect(f.service.action(accountId,{type:'build'},'build-missing-01')).rejects.toThrow('10 steel and 10 planks');
   const saved=await f.store.get(key);expect(saved!.state.player.facility).toBe(false);expect(saved!.state.player.inventory.steel).toBe(Number(steel));expect(saved!.state.player.inventory.planks).toBe(Number(planks));
   expect(f.player.refinery).toBe(false);expect(f.harvest).not.toHaveBeenCalled();
  }finally{await cleanup(f.directory);}
 });

 it('requires arrival at the construction plot even with all materials',async()=>{
  const f=await fixture();try{
   await position(f.store,'depot');f.player.inventory[4]='10';f.player.inventory[5]='10';
   await expect(f.service.action(accountId,{type:'build'},'build-too-far-01')).rejects.toThrow('Move closer');
   expect(f.player.inventory.slice(4)).toEqual(['10','10']);expect(f.player.refinery).toBe(false);
  }finally{await cleanup(f.directory);}
 });

 it('prepares fee-free owned refining and waits for finalized material conversion',async()=>{
  const f=await fixture();try{
   await position(f.store,'plot');f.player.refinery=true;f.player.inventory[0]='6';f.player.inventory[3]='1';f.player.balance='0';
   const prepared=await f.service.action(accountId,{type:'process',resource:'crude',quantity:4},'owned-refine-01');
   expect(prepared.chainAction).toMatchObject({method:'refine_owned',args:{batches:2},deposit:'1'});expect(prepared.chainAction?.costYocto).toBeUndefined();
   expect(prepared.state.player.facility).toBe(true);expect(prepared.state.player.inventory).toMatchObject({crude:6,petrol:1});expect(prepared.state.live!.balanceYocto).toBe('0');
   expect(f.player.inventory[0]).toBe('6');expect(f.player.inventory[3]).toBe('1');expect(f.harvest).not.toHaveBeenCalled();expect(f.fuel).not.toHaveBeenCalled();
   f.player.inventory[0]='2';f.player.inventory[3]='3';
   const confirmed=await f.service.session(accountId);expect(confirmed.player.inventory).toMatchObject({crude:2,petrol:3});expect(confirmed.live!.balanceYocto).toBe('0');
  }finally{await cleanup(f.directory);}
 });

 it('refuses owned production when the finalized account has no refinery',async()=>{
  const f=await fixture();try{
   await position(f.store,'plot');f.player.inventory[0]='4';
   await f.store.mutate(key,old=>{const next=structuredClone(old);next.state.player.facility=true;next.state.revision++;return next;});
   await expect(f.service.action(accountId,{type:'process',resource:'crude',quantity:4},'owned-without-building-01')).rejects.toThrow('Move closer');
   expect((await f.store.get(key))!.state.player.facility).toBe(false);expect(f.player.inventory[0]).toBe('4');expect(f.player.inventory[3]).toBe('0');
  }finally{await cleanup(f.directory);}
 });

 it('refuses owned production without enough finalized crude',async()=>{
  const f=await fixture();try{
   await position(f.store,'plot');f.player.refinery=true;f.player.inventory[0]='3';
   await expect(f.service.action(accountId,{type:'process',resource:'crude',quantity:4},'owned-insufficient-01')).rejects.toThrow('not have enough raw material');
   expect(f.player.inventory[0]).toBe('3');expect(f.player.inventory[3]).toBe('0');
  }finally{await cleanup(f.directory);}
 });

 it('does not turn the owned refinery into a processor for other resources',async()=>{
  const f=await fixture();try{
   await position(f.store,'plot');f.player.refinery=true;f.player.inventory[1]='4';
   await expect(f.service.action(accountId,{type:'process',resource:'ore',quantity:4},'owned-wrong-resource-01')).rejects.toThrow('crude oil only');
   expect(f.player.inventory[1]).toBe('4');expect(f.player.inventory[4]).toBe('0');
  }finally{await cleanup(f.directory);}
 });
});
