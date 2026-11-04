import {describe,it,expect} from 'vitest';
import {applyAction,migrateNavigation,newGame,NAVIGATION_VERSION} from '../server/economy';
import {bodyCollides,clipCameraToWorld,findSafeVehicleExit,motionIsClear,parkedVehicleCollider,resolveWorldMotion,walkingDirection} from '../shared/world-physics';
import {getWorldColliders,SERVICE_NPCS,TOWN_DOORS,TOWN_FENCES,TOWN_TREES} from '../shared/town';

describe('walking and full vehicle geometry',()=>{
 it('turns a walker to face backwards travel without reversing the camera basis',()=>{
  const backward=walkingDirection(-1,0,0);
  expect(backward.x).toBeCloseTo(0);expect(backward.z).toBeCloseTo(1);expect(Math.abs(backward.heading)).toBeCloseTo(Math.PI);
  expect(walkingDirection(-1,0,0)).toEqual(backward);
  expect(walkingDirection(1,0,Math.PI/2).x).toBeCloseTo(-1);
 });
 it('keeps diagonal walking at the same maximum speed',()=>{
  const diagonal=walkingDirection(1,1,0);expect(diagonal.strength).toBe(1);expect(Math.hypot(diagonal.x,diagonal.z)).toBeCloseTo(1);expect(diagonal.x).toBeGreaterThan(0);expect(diagonal.z).toBeLessThan(0);
 });
 it('collides with a bumper obstacle outside the old centre-radius check',()=>{
  expect(bodyCollides({x:0,z:0},0,true,[{x:0,z:2,w:.5,d:.2}])).toBe(true);
  expect(bodyCollides({x:0,z:0},0,false,[{x:0,z:2,w:.5,d:.2}])).toBe(false);
 });
 it('includes the corners of a turned vehicle',()=>{
  const obstacle=[{x:2.2,z:.7,w:.25,d:.25}];
  expect(bodyCollides({x:0,z:0},0,true,obstacle)).toBe(false);
  expect(bodyCollides({x:0,z:0},Math.PI/4,true,obstacle)).toBe(true);
 });
 it('does not tunnel through a thin fence at driving speed',()=>{
  const fence=[{x:0,z:0,w:8,d:.08}],motion=resolveWorldMotion({x:0,z:8},{x:0,z:-5},0,0,true,fence);
  expect(motion.blocked).toBe(true);expect(motion.position.z).toBeGreaterThanOrEqual(2.24);expect(bodyCollides(motion.position,motion.heading,true,fence)).toBe(false);
  expect(motionIsClear({x:0,z:8},{x:0,z:-5},0,0,true,fence)).toBe(false);
 });
 it('blocks rotational corner sweeps even when the vehicle centre stays still',()=>{
  const wall=[{x:1.8,z:.5,w:.3,d:.3}],motion=resolveWorldMotion({x:0,z:0},{x:0,z:0},0,Math.PI/2,true,wall);
  expect(motion.blocked).toBe(true);expect(motion.heading).toBeLessThan(Math.PI/2);expect(bodyCollides(motion.position,motion.heading,true,wall)).toBe(false);
 });
 it('slides a pedestrian along a wall without crossing it',()=>{
  const wall=[{x:0,z:0,w:.1,d:10}],motion=resolveWorldMotion({x:-1,z:0},{x:1,z:2},0,0,false,wall);
  expect(motion.blocked).toBe(true);expect(motion.position.x).toBeLessThanOrEqual(-.37);expect(motion.position.z).toBeCloseTo(2);expect(bodyCollides(motion.position,0,false,wall)).toBe(false);
 });
 it('keeps every part of the vehicle within the flat playable ground',()=>{
  const motion=resolveWorldMotion({x:95,z:0},{x:105,z:0},Math.PI/2,Math.PI/2,true,[]);
  expect(motion.blocked).toBe(true);expect(motion.position.x).toBeLessThanOrEqual(96.8);expect(bodyCollides(motion.position,motion.heading,true,[])).toBe(false);
 });
 it('uses the rendered tree and fence footprints in the shared collision set',()=>{
  const tree=TOWN_TREES[0],fence=TOWN_FENCES[0],colliders=getWorldColliders();
  expect(bodyCollides({x:tree.x,z:tree.z},0,true,colliders)).toBe(true);
  expect(bodyCollides({x:fence.x+fence.length/2,z:fence.z},0,false,colliders)).toBe(true);
 });
 it('keeps walking players outside a parked pickup',()=>{
  const pickup=parkedVehicleCollider({x:0,z:0},0),motion=resolveWorldMotion({x:-4,z:0},{x:4,z:0},0,0,false,[pickup]);
  expect(motion.blocked).toBe(true);expect(motion.position.x).toBeLessThanOrEqual(-1.52);
 });
 it('makes fixed shopkeepers solid for people and vehicles',()=>{
  const npc=SERVICE_NPCS[0],colliders=getWorldColliders();
  expect(bodyCollides(npc.position,0,false,colliders)).toBe(true);expect(bodyCollides(npc.position,0,true,colliders)).toBe(true);
 });
 it('prevents a camera ray passing through a wall despite a clear endpoint',()=>{
  const camera=clipCameraToWorld({x:0,y:1.5,z:0},{x:0,y:2,z:8},[{x:0,z:3,w:8,d:.2}]);
  expect(camera.z).toBeLessThan(2.8);expect(camera.y).toBeGreaterThanOrEqual(.55);
 });
 it('finds an exit on the unobstructed side without teleporting through a wall',()=>{
  const wall=[{x:1.4,z:0,w:.2,d:8}],exit=findSafeVehicleExit({x:0,z:0},0,wall);
  expect(exit).not.toBeNull();expect(exit!.x).toBeLessThan(0);expect(bodyCollides(exit!,0,false,wall)).toBe(false);
 });
});

describe('authoritative doors and collisions',()=>{
 const door=TOWN_DOORS.find(door=>door.id==='supply-door')!;
 it('allows walking through an opened doorway while blocking a closed one',()=>{
  const outside={x:door.position.x,z:door.position.z+1.2},inside={x:door.position.x,z:door.position.z-1.2};
  expect(motionIsClear(outside,inside,0,0,false,getWorldColliders())).toBe(false);
  expect(motionIsClear(outside,inside,0,0,false,getWorldColliders([door.id]))).toBe(true);
  // The entrance admits people; it does not admit the pickup's mirrors.
  expect(motionIsClear({...outside,z:outside.z+2},{...inside,z:inside.z-2},0,0,true,getWorldColliders([door.id]))).toBe(false);
 });
 it('persists the open door and permits the corresponding server movement',()=>{
  const game=newGame('door-path',1000);game.state.player.position={x:door.position.x,z:door.position.z+1.2};
  const opened=applyAction(game,{type:'toggleDoor',doorId:door.id},1100);expect(opened.state.doors?.[door.id]).toBe(true);
  const moved=applyAction(opened,{type:'move',x:door.position.x,z:door.position.z-.8,heading:0,driving:false},1600);
  expect(moved.state.player.position.z).toBeLessThan(door.position.z);expect(moved.state.doors?.[door.id]).toBe(true);
 });
 it('rejects walking through closed doors and travelling through scenery server-side',()=>{
  const game=newGame('closed-door',1000);game.state.player.position={x:door.position.x,z:door.position.z+1.2};
  expect(()=>applyAction(game,{type:'move',x:door.position.x,z:door.position.z-1.2,heading:0,driving:false},2000)).toThrow('obstacle');
  const tree=TOWN_TREES[0];game.state.player.position={x:tree.x,z:tree.z+1.5};
  expect(()=>applyAction(game,{type:'move',x:tree.x,z:tree.z-1.5,heading:0,driving:false},2000)).toThrow('obstacle');
 });
 it('rejects walking through a parked vehicle or boarding through a wall',()=>{
  const game=newGame('pickup-obstacles',1000);game.state.truckPosition={x:20,z:20};game.state.truckHeading=0;game.state.player.position={x:17,z:20};
  expect(()=>applyAction(game,{type:'move',x:23,z:20,heading:0,driving:false},2000)).toThrow('obstacle');
  game.state.player.position={x:-5,z:7};game.state.truckPosition={x:-8,z:7};
  expect(()=>applyAction(game,{type:'enterVehicle'},2000)).toThrow('Walk around');
 });
 it('requires on-foot proximity and does not close a door onto someone',()=>{
  const game=newGame('door-safety',1000);
  expect(()=>applyAction(game,{type:'toggleDoor',doorId:door.id},1100)).toThrow('closer');
  game.state.player.position={x:door.position.x,z:door.position.z+1};game.state.player.driving=true;
  expect(()=>applyAction(game,{type:'toggleDoor',doorId:door.id},1100)).toThrow('Step out');
  game.state.player.driving=false;game.state.doors={[door.id]:true};game.state.player.position={...door.position};
  expect(()=>applyAction(game,{type:'toggleDoor',doorId:door.id},1100)).toThrow('Step away');expect(game.state.doors[door.id]).toBe(true);
 });
});

describe('existing world navigation migration',()=>{
 it.each(['demo','live'] as const)('frees overlapping %s bodies without changing the economy',mode=>{
  const game=newGame('old-world',1000),tree=TOWN_TREES[0];delete game.meta.navigationVersion;game.state.mode=mode;game.state.player.position={x:tree.x,z:tree.z};game.state.truckPosition={x:tree.x,z:tree.z};game.state.player.inventory.ore=7;game.state.player.balance=42;
  const migrated=migrateNavigation(game,2000),colliders=getWorldColliders();
  expect(bodyCollides(migrated.state.player.position,migrated.state.player.heading,false,colliders)).toBe(false);
  expect(bodyCollides(migrated.state.truckPosition!,migrated.state.truckHeading!,true,colliders)).toBe(false);
  expect(migrated.state.player.inventory).toEqual(game.state.player.inventory);expect(migrated.state.player.balance).toBe(42);expect(migrated.state.merchants).toEqual(game.state.merchants);expect(migrated.state.mode).toBe(mode);
  expect(migrated.meta.navigationVersion).toBe(NAVIGATION_VERSION);expect(migrateNavigation(migrated,3000)).toBe(migrated);
 });
 it('preserves clear positions and repairs pending oracle world positions without touching the command',()=>{
  const game=newGame('pending-world',1000);delete game.meta.navigationVersion;const after=structuredClone(game.state),tree=TOWN_TREES[0];after.player.position={x:tree.x,z:tree.z};after.player.inventory.crude=2;
  game.meta.pendingOracle={nonce:4,kind:'harvest',resource:'crude',amount:2,createdAt:1000,attempts:1,lastAttemptAt:1000,after,lastGatherAt:1000,requestId:'original-request'};
  const migrated=migrateNavigation(game,2000);
  expect(migrated.state.player.position).toEqual(game.state.player.position);expect(migrated.state.truckPosition).toEqual(game.state.truckPosition);
  expect(bodyCollides(migrated.meta.pendingOracle!.after.player.position,0,false,getWorldColliders())).toBe(false);
  expect({...migrated.meta.pendingOracle,after:undefined}).toEqual({...game.meta.pendingOracle,after:undefined});expect(migrated.meta.pendingOracle!.after.player.inventory.crude).toBe(2);
 });
 it('recovers an old vehicle centred beyond the full-footprint world boundary',()=>{
  const game=newGame('old-edge',1000);delete game.meta.navigationVersion;game.state.player.driving=true;game.state.player.position={x:99,z:99};game.state.truckPosition={x:99,z:99};
  const migrated=migrateNavigation(game,2000);expect(bodyCollides(migrated.state.player.position,migrated.state.player.heading,true,getWorldColliders())).toBe(false);expect(migrated.state.player.position).toEqual(migrated.state.truckPosition);
 });
});
