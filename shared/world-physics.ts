import type {Vec2} from './types';
import type {Collider} from './world-layout';

export const WALKING_RADIUS=.32;
export const VEHICLE_HALF_WIDTH=1.2;
export const VEHICLE_HALF_LENGTH=2.2;
export const PHYSICS_WORLD_LIMIT=99;
export const parkedVehicleCollider=(position:Vec2,heading:number):Collider=>({...position,w:VEHICLE_HALF_WIDTH*2,d:VEHICLE_HALF_LENGTH*2,rotation:heading,height:2.1});
const STEP=.12;
const angleDelta=(from:number,to:number)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
type Rect={x:number;z:number;w:number;d:number;rotation?:number};
const axes=(heading:number)=>[{x:Math.cos(heading),z:-Math.sin(heading)},{x:Math.sin(heading),z:Math.cos(heading)}];

function circleRect(position:Vec2,radius:number,rect:Rect):boolean{
 const bound=Math.hypot(rect.w,rect.d)/2;if(Math.abs(position.x-rect.x)>bound+radius||Math.abs(position.z-rect.z)>bound+radius)return false;
 const [right,back]=axes(rect.rotation??0),dx=position.x-rect.x,dz=position.z-rect.z;
 const x=dx*right.x+dz*right.z,z=dx*back.x+dz*back.z;
 return Math.hypot(Math.max(0,Math.abs(x)-rect.w/2),Math.max(0,Math.abs(z)-rect.d/2))<radius-1e-7;
}
function rectanglesOverlap(a:Rect,b:Rect):boolean{
 const aa=axes(a.rotation??0),ba=axes(b.rotation??0),dx=b.x-a.x,dz=b.z-a.z;
 for(const axis of [...aa,...ba]){
  const radiusA=Math.abs(axis.x*aa[0].x+axis.z*aa[0].z)*a.w/2+Math.abs(axis.x*aa[1].x+axis.z*aa[1].z)*a.d/2;
  const radiusB=Math.abs(axis.x*ba[0].x+axis.z*ba[0].z)*b.w/2+Math.abs(axis.x*ba[1].x+axis.z*ba[1].z)*b.d/2;
  if(Math.abs(dx*axis.x+dz*axis.z)>=radiusA+radiusB-1e-7)return false;
 }
 return true;
}

/** Matches the pickup's mirrors, bumpers and wheels, including its turned corners. */
export function bodyCollides(position:Vec2,heading:number,driving:boolean,colliders:readonly Collider[],limit=PHYSICS_WORLD_LIMIT):boolean{
 if(![position.x,position.z,heading].every(Number.isFinite))return true;
 if(!driving){
  if(Math.abs(position.x)+WALKING_RADIUS>limit||Math.abs(position.z)+WALKING_RADIUS>limit)return true;
  return colliders.some(c=>circleRect(position,WALKING_RADIUS,c));
 }
 const [right,back]=axes(heading),extentX=Math.abs(right.x)*VEHICLE_HALF_WIDTH+Math.abs(back.x)*VEHICLE_HALF_LENGTH,extentZ=Math.abs(right.z)*VEHICLE_HALF_WIDTH+Math.abs(back.z)*VEHICLE_HALF_LENGTH;
 if(Math.abs(position.x)+extentX>limit||Math.abs(position.z)+extentZ>limit)return true;
 const vehicle={...position,w:VEHICLE_HALF_WIDTH*2,d:VEHICLE_HALF_LENGTH*2,rotation:heading};
 return colliders.some(c=>{
  const bound=c.rotation?Math.hypot(c.w,c.d)/2:0;
  if(Math.abs(position.x-c.x)>extentX+(bound||c.w/2)||Math.abs(position.z-c.z)>extentZ+(bound||c.d/2))return false;
  return rectanglesOverlap(vehicle,c);
 });
}

/** Substeps translation and rotation so a long frame cannot jump a thin fence. */
export function resolveWorldMotion(from:Vec2,target:Vec2,fromHeading:number,toHeading:number,driving:boolean,colliders:readonly Collider[],slide=true):{position:Vec2;heading:number;blocked:boolean}{
 const distance=Math.hypot(target.x-from.x,target.z-from.z),rotation=angleDelta(fromHeading,toHeading);
 const count=Math.max(1,Math.ceil(distance/STEP),Math.ceil(Math.abs(rotation)/.035));
 if(!Number.isFinite(count)||count>4096)return{position:{...from},heading:fromHeading,blocked:true};
 let position={...from},heading=fromHeading,blocked=false;
 const dx=(target.x-from.x)/count,dz=(target.z-from.z)/count,dh=rotation/count;
 for(let step=0;step<count;step++){
  const turned=heading+dh;
  if(!driving||!bodyCollides(position,turned,true,colliders))heading=turned;else blocked=true;
  const next={x:position.x+dx,z:position.z+dz};
  if(!bodyCollides(next,heading,driving,colliders)){position=next;continue;}
  blocked=true;if(!slide)break;
  const horizontal={x:position.x+dx,z:position.z};if(!bodyCollides(horizontal,heading,driving,colliders))position=horizontal;
  const vertical={x:position.x,z:position.z+dz};if(!bodyCollides(vertical,heading,driving,colliders))position=vertical;
 }
 return{position,heading,blocked};
}

/** Rejects both occupied destinations and paths crossing solid geometry. */
export function motionIsClear(from:Vec2,target:Vec2,fromHeading:number,toHeading:number,driving:boolean,colliders:readonly Collider[]):boolean{
 const resolved=resolveWorldMotion(from,target,fromHeading,toHeading,driving,colliders,false);
 return !resolved.blocked&&Math.hypot(resolved.position.x-target.x,resolved.position.z-target.z)<.005;
}

export function findSafeVehicleExit(position:Vec2,heading:number,colliders:readonly Collider[]):Vec2|null{
 const [right,back]=axes(heading);
 const offsets=[[1.8,0],[-1.8,0],[1.8,-1],[-1.8,-1],[0,2.9],[0,-2.9],[2.4,1],[-2.4,1]];
 for(const [side,along]of offsets){
  const candidate={x:position.x+right.x*side+back.x*along,z:position.z+right.z*side+back.z*along};
  if(bodyCollides(candidate,heading,false,colliders))continue;
  // Start at the door edge, not at the cabin centre; the vehicle itself is not
  // an obstacle here, but an intervening building wall still blocks exiting.
  const edge={x:position.x+right.x*Math.sign(side)*Math.min(Math.abs(side),VEHICLE_HALF_WIDTH),z:position.z+right.z*Math.sign(side)*Math.min(Math.abs(side),VEHICLE_HALF_WIDTH)};
  if(motionIsClear(edge,candidate,heading,heading,false,colliders))return candidate;
 }
 return null;
}

/** Camera-relative walking always faces its travel direction, including S. */
export function walkingDirection(forward:number,sideways:number,cameraYaw:number):{x:number;z:number;heading:number;strength:number}{
 const length=Math.hypot(forward,sideways),strength=Math.min(1,length);
 if(length<.001)return{x:0,z:0,heading:cameraYaw,strength:0};
 const x=(Math.cos(cameraYaw)*sideways-Math.sin(cameraYaw)*forward)/length,z=(-Math.sin(cameraYaw)*sideways-Math.cos(cameraYaw)*forward)/length;
 return{x,z,heading:Math.atan2(-x,-z),strength};
}

/** Keep a held movement gesture in world space while the follow camera turns.
 * Releasing the controls captures the new view direction for the next gesture. */
export function walkingReferenceYaw(previous:number|null,forward:number,sideways:number,cameraYaw:number):number|null{
 return Math.hypot(forward,sideways)<.08?null:previous??cameraYaw;
}

export function clearLineOfSight(from:Vec2,to:Vec2,colliders:readonly Collider[],radius=.04):boolean{
 const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.15));
 for(let i=1;i<steps;i++){const t=i/steps,p={x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t};if(colliders.some(c=>c.kind!=='npc'&&circleRect(p,radius,c)))return false;}
 return true;
}

export type CameraCollider=Collider&{bottom?:number};

/** Continuous swept camera volume. The clearance encloses the entire near plane,
 * including its corners; elevated lintels and roofs need a real bottom bound. */
export function clipCameraToWorld(from:Vec2&{y:number},to:Vec2&{y:number},colliders:readonly CameraCollider[],clearance=.24):Vec2&{y:number}{
 const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z,distance=Math.hypot(dx,dy,dz);let nearest=1;
 if(distance<1e-8)return{...from};
 for(const c of colliders){
  const [right,back]=axes(c.rotation??0),ox=from.x-c.x,oz=from.z-c.z;
  const origin=[ox*right.x+oz*right.z,from.y,ox*back.x+oz*back.z];
  const delta=[dx*right.x+dz*right.z,dy,dx*back.x+dz*back.z];
  const min=[-c.w/2-clearance,(c.bottom??0)-clearance,-c.d/2-clearance],max=[c.w/2+clearance,(c.height??6)+clearance,c.d/2+clearance];
  let entry=0,exit=nearest,hit=true;
  for(let axis=0;axis<3;axis++){
   if(Math.abs(delta[axis])<1e-9){if(origin[axis]<min[axis]||origin[axis]>max[axis]){hit=false;break;}}
   else{let a=(min[axis]-origin[axis])/delta[axis],b=(max[axis]-origin[axis])/delta[axis];if(a>b)[a,b]=[b,a];entry=Math.max(entry,a);exit=Math.min(exit,b);if(entry>exit){hit=false;break;}}
  }
  if(hit&&exit>=0)nearest=Math.min(nearest,Math.max(0,entry-.015/distance));
 }
 return{x:from.x+dx*nearest,y:Math.max(.35,from.y+dy*nearest),z:from.z+dz*nearest};
}
