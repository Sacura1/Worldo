import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {applyAction,newGame} from '../server/economy';
import {GameStore} from '../server/store';
import {collidesWithWorld,findVehicleExit,TRUCK_RADIUS,WALK_RADIUS,WORLD_LIMIT} from '../shared/world-layout';

describe('pickup exit safety',()=>{
 it('steps away from the depot wall instead of trapping the player inside it',()=>{
  const game=newGame('beside-depot',1000);
  game.state.player.position={x:-7.1,z:5};game.state.player.driving=true;
  expect(collidesWithWorld(game.state.player.position,TRUCK_RADIUS)).toBe(false);
  expect(collidesWithWorld({x:-5.1,z:5},WALK_RADIUS)).toBe(true);
  const exited=applyAction(game,{type:'exitVehicle'},1200);
  expect(exited.state.player.driving).toBe(false);
  expect(exited.state.truckPosition).toEqual({x:-7.1,z:5});
  expect(exited.state.player.position.x).toBeLessThan(-7.1);
  expect(collidesWithWorld(exited.state.player.position,WALK_RADIUS)).toBe(false);
  const step={x:exited.state.player.position.x-.2,z:exited.state.player.position.z};
  expect(collidesWithWorld(step,WALK_RADIUS)).toBe(false);
  expect(applyAction(exited,{type:'move',...step,heading:0,driving:false},1400).state.player.position).toEqual(step);
 });
 it('still permits a safe exit when the fuel tank is empty',()=>{
  const game=newGame();game.state.player.position={x:-7.1,z:5};game.state.player.driving=true;game.state.player.fuel=0;
  const exited=applyAction(game,{type:'exitVehicle'});
  expect(exited.state.player.driving).toBe(false);expect(collidesWithWorld(exited.state.player.position,WALK_RADIUS)).toBe(false);
 });
 it('keeps the driver and parked position unchanged if no nearby exit is clear',()=>{
  const game=newGame();game.state.player.position={x:0,z:5};game.state.player.driving=true;
  const before=structuredClone(game);
  expect(()=>applyAction(game,{type:'exitVehicle'})).toThrow('no room to step out');
  expect(game).toEqual(before);
 });
 it.each([{x:99,z:99},{x:-99,z:99},{x:99,z:-99},{x:-99,z:-99}])('finds an exit within the world boundary at $x, $z',position=>{
  const exit=findVehicleExit(position,0);
  expect(exit).not.toBeNull();expect(Math.abs(exit!.x)).toBeLessThanOrEqual(WORLD_LIMIT);expect(Math.abs(exit!.z)).toBeLessThanOrEqual(WORLD_LIMIT);
  expect(collidesWithWorld(exit!,WALK_RADIUS)).toBe(false);
 });
});

describe('parked pickup heading',()=>{
 it('persists heading through driving, parking, reloading and boarding from another direction',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'worldo-navigation-'));
  try{
   const store=new GameStore(directory,undefined),id='b'.repeat(64),heading=1.1;
   await store.create(id);
   await store.mutate(id,old=>{
    const game=structuredClone(old),now=Date.now();game.state.player.position={...game.state.truckPosition!};
    const boarded=applyAction(game,{type:'enterVehicle'},now);
    const driven=applyAction(boarded,{type:'move',x:9,z:23,heading,driving:true},now+200);
    expect(driven.state.truckHeading).toBe(heading);
    return applyAction(driven,{type:'exitVehicle'},now+400);
   });
   const restored=(await new GameStore(directory,undefined).get(id))!;
   expect(restored.state.truckPosition).toEqual({x:9,z:23});expect(restored.state.truckHeading).toBe(heading);
   restored.state.player.heading=-2;
   const boarded=applyAction(restored,{type:'enterVehicle'});
   expect(boarded.state.player.heading).toBe(heading);expect(boarded.state.player.position).toEqual(restored.state.truckPosition);
  }finally{if(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))await rm(directory,{recursive:true,force:true});}
 });
 it('migrates an old driving save using its current vehicle heading',()=>{
  const game=newGame();delete game.state.truckHeading;game.state.player.driving=true;game.state.player.heading=.8;
  expect(applyAction(game,{type:'exitVehicle'}).state.truckHeading).toBe(.8);
 });
});
