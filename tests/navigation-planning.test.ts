import {describe,it,expect} from 'vitest';
import {walkingPath,distance} from '../e2e/navigation';
import {applyAction,newGame} from '../server/economy';
import {getWorldColliders,NPC_INTERACTION_RADIUS,SERVICE_NPCS,TOWN_DOORS} from '../shared/town';
import {bodyCollides,motionIsClear,resolveWorldMotion,walkingDirection} from '../shared/world-physics';

describe('public scanner waypoint routing',()=>{
 it('keeps the refinery conversation fixture closer to Hale and outside door range',()=>{
  const point={x:50.3,z:-29.5},tolerance=.4,npc=SERVICE_NPCS.find(npc=>npc.id==='hale')!,door=TOWN_DOORS.find(door=>door.id==='refinery-office-door')!;
  expect(distance(point,npc.position)+tolerance).toBeLessThan(NPC_INTERACTION_RADIUS);
  expect(distance(point,door.position)-tolerance).toBeGreaterThan(3);
  expect(bodyCollides(point,0,false,getWorldColliders([door.id]))).toBe(false);
 });
 it('continues southeast from the reported refinery-corner timeout without a collision',()=>{
  let game=newGame('refinery-corner',1000);game.state.player.position={x:40.48,z:-30.39};const goal={x:42,z:-28},colliders=getWorldColliders();
  expect(bodyCollides(game.state.player.position,0,false,colliders)).toBe(false);
  for(let i=0;i<20&&distance(game.state.player.position,goal)>.45;i++){
   const p=game.state.player.position,dx=goal.x-p.x,dz=goal.z-p.z,length=Math.hypot(dx,dz),side=dx/length,forward=-dz/length;
   const direction=walkingDirection(forward>.25?1:forward<-.25?-1:0,side>.25?1:side<-.25?-1:0,0),motion=resolveWorldMotion(p,{x:p.x+direction.x*.44,z:p.z+direction.z*.44},game.state.player.heading,direction.heading,false,colliders);
   game=applyAction(game,{type:'move',...motion.position,heading:motion.heading,driving:false},1200+i*200);
  }
  expect(distance(game.state.player.position,goal)).toBeLessThan(.45);
 });
 it.each([
  {target:{x:28.13828856760381,z:-70.57188177091035},tolerance:1},
  {target:{x:29,z:-69},tolerance:2.2},
 ])('reaches clear ground beside an obstructed hint at $target.x,$target.z',({target,tolerance})=>{
  const game=newGame().state,from={x:25,z:-59},colliders=getWorldColliders();
  expect(bodyCollides(target,0,false,colliders)).toBe(true);
  const route=walkingPath(from,target,game,tolerance);expect(route.length).toBeGreaterThan(0);
  let previous=from;for(const point of route){expect(motionIsClear(previous,point,0,0,false,colliders)).toBe(true);previous=point;}
  expect(bodyCollides(previous,0,false,colliders)).toBe(false);expect(distance(previous,target)).toBeLessThan(tolerance);
 });
});
