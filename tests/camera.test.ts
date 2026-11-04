import {describe,it,expect} from 'vitest';
import {clipCameraToWorld,walkingDirection,walkingReferenceYaw,type CameraCollider} from '../shared/world-physics';
import {getWorldColliders,TOWN_DOORS} from '../shared/town';

describe('automatic on-foot camera follow',()=>{
 it.each([[-1,0],[0,1],[1,1]])('keeps held input %s/%s straight while the camera catches up', (forward,sideways)=>{
  let reference:number|null=null,cameraYaw=0;
  const expected=walkingDirection(forward,sideways,0);
  for(let frame=0;frame<180;frame++){
   reference=walkingReferenceYaw(reference,forward,sideways,cameraYaw);
   const movement=walkingDirection(forward,sideways,reference??cameraYaw);
   expect(movement.x).toBeCloseTo(expected.x,10);expect(movement.z).toBeCloseTo(expected.z,10);
   cameraYaw+=Math.atan2(Math.sin(movement.heading-cameraYaw),Math.cos(movement.heading-cameraYaw))*(1-Math.exp(-4.5/60));
  }
  expect(Math.abs(Math.atan2(Math.sin(cameraYaw-expected.heading),Math.cos(cameraYaw-expected.heading)))).toBeLessThan(.001);
 });
 it('uses the turned view on the next gesture, including a mobile stick release',()=>{
  let reference=walkingReferenceYaw(null,-1,0,0);
  reference=walkingReferenceYaw(reference,.01,-.02,Math.PI);
  expect(reference).toBeNull();
  reference=walkingReferenceYaw(reference,1,0,Math.PI);
  expect(walkingDirection(1,0,reference!).z).toBeCloseTo(1);
 });
});

describe('enclosed-room camera clearance',()=>{
 it('stops the full lens volume at a thin wall instead of only checking the endpoint',()=>{
  const wall={x:0,z:3,w:10,d:.02,height:4},camera=clipCameraToWorld({x:0,y:1.25,z:0},{x:0,y:2,z:20},[wall],.3);
  expect(camera.z).toBeLessThan(3-.01-.3);expect(camera.z).toBeGreaterThan(2.65);
 });
 it('respects rotated door leaves and wide-screen near-plane clearance',()=>{
  const door={x:0,z:3,w:2,d:.12,height:2.65,rotation:Math.PI/4};
  const camera=clipCameraToWorld({x:0,y:1.25,z:0},{x:0,y:1.8,z:6},[door],.3);
  // At x=0 the diagonal slab starts at z=3-(.06+.3)/cos(45°).
  expect(camera.z).toBeLessThan(3-.36/Math.cos(Math.PI/4));expect(camera.z).toBeGreaterThan(2.4);
 });
 it('allows the camera beneath an awning while stopping it from entering its roof',()=>{
  const roof:CameraCollider={x:0,z:3,w:8,d:2,bottom:2.6,height:3};
  const low=clipCameraToWorld({x:0,y:1.25,z:0},{x:0,y:1.8,z:6},[roof]);
  expect(low.z).toBe(6);
  const high=clipCameraToWorld({x:0,y:1.25,z:0},{x:0,y:4,z:6},[roof]);
  expect(high.z).toBeLessThan(4.24);expect(high.y).toBeLessThan(2.6-.24);
 });
 it('keeps an indoor camera below the intact ceiling',()=>{
  const ceiling:CameraCollider={x:0,z:4,w:12,d:10,bottom:3.68,height:6.9};
  const camera=clipCameraToWorld({x:0,y:1.25,z:5},{x:0,y:7,z:7},[ceiling]);
  expect(camera.y).toBeLessThan(3.68-.24);expect(camera.y).toBeGreaterThan(3.4);
 });
 it('keeps a returning shop view through the open aperture, below the lintel',()=>{
  const door=TOWN_DOORS.find(d=>d.id==='supply-door')!,z=door.position.z;
  const colliders:CameraCollider[]=[...getWorldColliders([door.id]),{x:0,z,w:2.2,d:.24,bottom:2.65,height:3.8}];
  const camera=clipCameraToWorld({x:0,y:1.25,z:z+.6},{x:0,y:2,z:z-2.5},colliders);
  expect(camera.z).toBeCloseTo(z-2.5);expect(camera.y).toBe(2);
  const raised=clipCameraToWorld({x:0,y:1.25,z:z+.6},{x:0,y:4,z:z-.1},colliders);
  expect(raised.y).toBeLessThan(2.65-.24);
 });
});
