import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PLACES } from '../../shared/types';
import {BUILDINGS,TANKS,COUNTERS,ROADS,WORLD_COLLIDERS,type Collider,type Footprint,type TankFootprint} from '../../shared/world-layout';
import {bodyCollides,VEHICLE_HALF_WIDTH,VEHICLE_HALF_LENGTH,type CameraCollider} from '../../shared/world-physics';
import {TOWN_BUILDINGS,TOWN_DOORS,TOWN_TREES,TOWN_ROCKS,TOWN_FENCES,TOWN_PROPS,TOWN_LAMPS,SERVICE_NPCS,FUEL_PUMPS,TOWN_RESIDENTS,getWorldColliders,getTownInterior,type TownBuilding} from '../../shared/town';
import type {Vec2} from '../../shared/types';

export const randomGenerator=(seed:number)=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const rnd=randomGenerator(2409);
const boxGeometry=new THREE.BoxGeometry(1,1,1);
const cylinderGeometry=new THREE.CylinderGeometry(1,1,1,12);
const coneGeometry=new THREE.ConeGeometry(1,1,9);
const sphereGeometry=new THREE.SphereGeometry(1,10,7);
const roundedGeometry=new RoundedBoxGeometry(1,1,1,2,.12);
const materials:Record<string,THREE.MeshStandardMaterial>={};
function texture(kind:'ground'|'concrete'|'metal'|'wood'|'road',base:string):THREE.CanvasTexture {
 const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d')!;x.fillStyle=base;x.fillRect(0,0,256,256);
 const r=randomGenerator(9121);for(let i=0;i<8000;i++){const a=r();x.fillStyle=`rgba(${a>.55?'255,255,235':'40,35,24'},${r()*(kind==='concrete'?.035:.065)})`;const w=kind==='wood'?1:kind==='metal'?1:1+r()*2;x.fillRect(r()*256,r()*256,w,kind==='wood'?12+r()*45:kind==='metal'?15:1+r()*2);}
 if(kind==='metal'){for(let i=0;i<256;i+=16){x.fillStyle='rgba(20,30,25,.16)';x.fillRect(i,0,2,256);x.fillStyle='rgba(255,255,255,.12)';x.fillRect(i+3,0,2,256);} }
 if(kind==='concrete'){x.strokeStyle='rgba(40,45,40,.18)';x.lineWidth=1;x.strokeRect(0,0,128,128);x.strokeRect(128,128,128,128);}
 if(kind==='wood'){x.strokeStyle='rgba(30,20,10,.25)';for(let i=0;i<256;i+=40){x.beginPath();x.moveTo(i,0);x.lineTo(i+1,256);x.stroke();}}
 const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}
export function getMaterials(){
 if(Object.keys(materials).length)return materials;
 const definitions:Record<string,[string,number,number]>={concrete:['#aaa8a5',.96,0],wall:['#d8c9b7',.91,0],roof:['#66707d',.85,.3],darkRoof:['#3e4652',.9,.3],wood:['#9c7450',.97,0],darkWood:['#604536',.99,0],rust:['#b36b4f',.83,.3],steel:['#9ca3ae',.57,.5],darkSteel:['#41454b',.66,.65],cream:['#f0e7d7',.88,.03],yellow:['#d2ad51',.73,.25],orange:['#c47c42',.8,.2],black:['#25262b',.96,0],rubber:['#29292c',1,0],glass:['#91b3c5',.22,.2],foliage:['#547644',1,0],foliageLight:['#7d9653',1,0],foliageDark:['#35563a',1,0],trunk:['#756044',1,0],stone:['#8c8984',1,0],stoneLight:['#b4ada4',1,0],skin:['#b98e6e',.93,0],jacket:['#687886',.95,0],pants:['#40505a',.95,0],bag:['#9f805e',.95,0],road:['#66666a',1,0],dirt:['#b8a286',1,0],grass:['#7a925f',1,0],brick:['#b4715e',.96,0],sage:['#8b9ca9',.95,0],ochre:['#c4a266',.96,0],shirtBlue:['#426e83',.98,0],shirtRed:['#9e4e43',.98,0],workOrange:['#ce8b45',.96,0],skinLight:['#d9ac88',.95,0],skinDark:['#76523c',.95,0],hairDark:['#2b2929',.98,0],hairBrown:['#604332',.98,0],white:['#f4f1eb',.9,0],rug:['#775247',1,0]};
 for(const [key,[color,roughness,metalness]] of Object.entries(definitions))materials[key]=new THREE.MeshStandardMaterial({color,roughness,metalness});
 for(const key of ['concrete','wall','cream']){materials[key].map=texture('concrete','#ffffff');}
 for(const key of ['roof','darkRoof'])materials[key].map=texture('metal','#ffffff');
 for(const key of ['wood','darkWood'])materials[key].map=texture('wood','#ffffff');
 materials.grass.map=texture('ground','#ecebe4');materials.grass.map.repeat.set(75,75);
 materials.dirt.map=texture('ground','#ddd2b4');materials.dirt.map.repeat.set(2,2);
 materials.road.map=texture('road','#d1cec4');materials.road.map.repeat.set(1,1);
 materials.vertex=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88});
 materials.window=new THREE.MeshStandardMaterial({color:'#abcac4',roughness:.16,metalness:.12,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide});
 return materials;
}
export class Builder {
 root=new THREE.Group();
 box(mat:string,x:number,y:number,z:number,w:number,h:number,d:number,rx=0,ry=0,rz=0){return this.mesh(boxGeometry,mat,x,y,z,w,h,d,rx,ry,rz);}
 rounded(mat:string,x:number,y:number,z:number,w:number,h:number,d:number,rx=0,ry=0,rz=0){return this.mesh(roundedGeometry,mat,x,y,z,w,h,d,rx,ry,rz);}
 cyl(mat:string,x:number,y:number,z:number,r:number,h:number,rx=0,ry=0,rz=0){return this.mesh(cylinderGeometry,mat,x,y,z,r,h,r,rx,ry,rz);}
 cone(mat:string,x:number,y:number,z:number,r:number,h:number){return this.mesh(coneGeometry,mat,x,y,z,r,h,r);}
 sphere(mat:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx){return this.mesh(sphereGeometry,mat,x,y,z,sx,sy,sz);}
 mesh(geo:THREE.BufferGeometry,mat:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,rx=0,ry=0,rz=0){const m=new THREE.Mesh(geo,getMaterials()[mat]);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;this.root.add(m);return m;}
 beam(mat:string,a:THREE.Vector3,b:THREE.Vector3,width=.1){const m=this.box(mat,0,0,0,width,a.distanceTo(b),width);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());return m;}
 label(text:string,x:number,y:number,z:number,w:number,h:number,rotation=0,bg='#303b31',fg='#eee8ce'){
  const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,1024,256);ctx.strokeStyle=fg;ctx.lineWidth=4;ctx.strokeRect(12,12,1000,232);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${text.length>20?53:70}px "Barlow Condensed", sans-serif`;ctx.fillText(text.toUpperCase(),512,132,940);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.MeshStandardMaterial({map:tex,roughness:.9});const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);m.position.set(x,y,z);m.rotation.y=rotation;this.root.add(m);return m;
 }
 batch(vertexColors=false){
  this.root.updateMatrixWorld(true);const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();const extra:THREE.Object3D[]=[];
  this.root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const mat=o.material as THREE.Material;const g=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrixWorld);if(mat===materials.road||mat===materials.dirt||mat===materials.concrete||mat===materials.wall){const p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv;for(let i=0;i<p.count;i++){const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));u.setXY(i,(ay>ax&&ay>az?p.getX(i):ax>az?p.getZ(i):p.getX(i))*.35,(ay>ax&&ay>az?p.getZ(i):p.getY(i))*.35);}}if(!batches.has(mat))batches.set(mat,[]);batches.get(mat)!.push(g);});
  if(vertexColors){const colored:THREE.BufferGeometry[]=[];for(const [material,geometries]of batches){const color=(material as THREE.MeshStandardMaterial).color;for(const g of geometries){const values=new Float32Array(g.attributes.position.count*3);for(let i=0;i<values.length;i+=3){values[i]=color.r;values[i+1]=color.g;values[i+2]=color.b;}g.setAttribute('color',new THREE.BufferAttribute(values,3));colored.push(g);}}batches.clear();batches.set(materials.vertex,colored);}
  const group=new THREE.Group();for(const [material,geometries]of batches){const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)continue;const m=new THREE.Mesh(merged,material);m.castShadow=true;m.receiveShadow=true;merged.computeBoundingSphere();group.add(m);}extra.forEach(o=>group.add(o));return group;
 }
}

function barrel(b:Builder,x:number,z:number,mat='rust',y=.48){b.cyl(mat,x,y,z,.32,.92);b.cyl('darkSteel',x,y+.31,z,.327,.035);b.cyl('darkSteel',x,y-.31,z,.327,.035);b.cyl('darkSteel',x+.11,y+.47,z,.04,.02);}
function crate(b:Builder,x:number,z:number,w=1,y=.5){b.box('wood',x,y,z,w,1,w);for(const s of[-1,1]){b.box('darkWood',x+s*w*.42,y,z,.08,1.06,w+.03);b.box('darkWood',x,y+.42,z,w+.03,.08,w+.03);b.box('darkWood',x,y-.42,z,w+.03,.08,w+.03);}}
function fence(b:Builder,x:number,z:number,length:number,ry=0){const g=new Builder();for(let i=0;i<=length;i+=2.5)g.box('wood',i,.75,0,.16,1.5,.16);g.box('wood',length/2,.55,0,length,.1,.12);g.box('wood',length/2,1.1,0,length,.1,.12);g.root.position.set(x,0,z);g.root.rotation.y=ry;b.root.add(g.root);}
function lamp(b:Builder,x:number,z:number,ry=0){b.cyl('darkSteel',x,3,z,.08,6);b.cyl('concrete',x,.25,z,.21,.5);const dx=Math.sin(ry)*.8,dz=Math.cos(ry)*.8;b.beam('darkSteel',new THREE.Vector3(x,6,z),new THREE.Vector3(x+dx,6,z+dz),.1);b.box('cream',x+dx,5.94,z+dz,.4,.13,.6);}
function warehouse(b:Builder,footprint:Footprint,h:number,mat='wall',roof='darkRoof'){
 const {x,z,w,d}=footprint;
 b.box('concrete',x,.15,z,w+.4,.3,d+.4);b.box(mat,x,h/2+.3,z,w,h,d);
 const roofH=w*.22,angle=Math.atan2(roofH,w/2);for(const side of[-1,1])b.box(roof,x+side*w/4,h+.3+roofH/2,z,w*.55,.16,d+.8,0,0,-side*angle);
 for(const end of[-1,1]){const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(0,roofH);shape.closePath();const g=new THREE.ShapeGeometry(shape);const m=new THREE.Mesh(g,getMaterials()[mat]);m.position.set(x,h+.3,z+end*d/2);if(end<0)m.rotation.y=Math.PI;b.root.add(m);}
 for(const side of[-1,1])for(let j=-d/2+.5;j<d/2;j+=2)b.box('darkSteel',x+side*w/2,h/2,z+j,.07,h,.09);
}
function tank(b:Builder,footprint:TankFootprint,h=5){const {x,z,r}=footprint;b.cyl('concrete',x,.2,z,r+.25,.4);b.cyl('cream',x,h/2+.4,z,r,h);b.cyl('rust',x,1.4,z,r+.015,.35);b.cyl('darkSteel',x,h+.42,z,r+.04,.12);b.sphere('cream',x,h+.44,z,r,.25,r);for(let a=0;a<Math.PI*2;a+=Math.PI/6){const dx=Math.sin(a)*r,dz=Math.cos(a)*r;b.box('steel',x+dx,h+.9,z+dz,.04,.9,.04);}b.cyl('steel',x,h+.9,z,r,.03);b.box('steel',x-r-.12,h/2,z,.1,h,.35);for(let i=.5;i<h;i+=.38)b.box('steel',x-r-.18,i,z,.12,.04,.55);}

export function createCharacter(style:{shirt?:string;skin?:string;hair?:string;hat?:boolean;backpack?:boolean;articulated?:boolean}={}){
 const shirt=style.shirt??'jacket',skin=style.skin??'skin',hair=style.hair??'hairBrown',root=new THREE.Group(),body=new Builder(),face=new Builder();
 const torso=new THREE.LatheGeometry([new THREE.Vector2(.185,.86),new THREE.Vector2(.205,.97),new THREE.Vector2(.185,1.08),new THREE.Vector2(.215,1.28),new THREE.Vector2(.255,1.4),new THREE.Vector2(.23,1.445),new THREE.Vector2(.11,1.51)],24);
 body.mesh(torso,shirt,0,0,0,1,1,.70);body.rounded('pants',0,.87,0,.40,.18,.29);body.box('darkWood',0,.94,0,.40,.04,.29);body.rounded('steel',0,.94,-.153,.055,.045,.018);
 for(const x of[-.12,.12]){body.rounded(shirt,x,1.28,-.15,.14,.16,.018);body.box('cream',x,1.34,-.165,.09,.012,.009);}body.box('darkSteel',0,1.22,-.16,.011,.43,.01);
 for(const side of[-1,1])body.rounded('cream',side*.062,1.46,-.09,.11,.09,.025,0,0,side*.4);
 if(style.backpack!==false){body.rounded('bag',0,1.23,.21,.32,.4,.16);body.rounded('darkWood',0,1.15,.3,.24,.16,.05);for(const x of[-.16,.16])body.box('bag',x,1.28,-.15,.035,.4,.025);}
 body.cyl(skin,0,1.54,0,.07,.14);face.sphere(skin,0,1.71,-.012,.135,.18,.132);face.sphere(skin,0,1.63,-.035,.10,.09,.10);
 face.sphere(hair,0,1.795,.02,.139,.105,.132);face.sphere(hair,-.08,1.765,-.07,.077,.065,.065);
 for(const x of[-.134,.134])face.sphere(skin,x,1.70,-.003,.024,.041,.024);
 for(const side of[-1,1]){face.sphere('white',side*.052,1.726,-.129,.025,.012,.008);face.sphere('hairDark',side*.052,1.725,-.137,.01,.011,.006);face.box(hair,side*.052,1.754,-.127,.048,.009,.008,0,0,side*.05);}
 face.sphere(skin,0,1.698,-.145,.024,.036,.03);face.rounded('shirtRed',0,1.658,-.132,.049,.009,.008);
 if(style.hat!==false){face.sphere(shirt,0,1.835,.012,.145,.07,.143);face.rounded(shirt,0,1.823,-.13,.25,.025,.17);}
 const head=new THREE.Group();head.position.y=1.54;
 if(style.articulated){root.add(body.batch(true));face.root.position.y=-1.54;head.add(face.batch(true));root.add(head);}else{body.root.add(face.root);root.add(body.batch(true));}
 const limbs:THREE.Group[]=[],knees:THREE.Group[]=[],wrists:THREE.Group[]=[];
 const profile=(points:number[][])=>new THREE.LatheGeometry(points.map(([radius,y])=>new THREE.Vector2(radius,y)),16);
 for(const side of[-1,1]){
  const leg=new THREE.Group();leg.position.set(side*.115,.9,0);leg.rotation.z=-side*.018;const thigh=new Builder();thigh.mesh(profile([[.075,-.45],[.085,-.37],[.105,-.17],[.108,-.04],[.085,.035]]),'pants',0,0,0,1,1,.92);thigh.rounded('pants',side*.075,-.16,0,.06,.21,.13);leg.add(thigh.batch(true));
  const knee=new THREE.Group();knee.position.set(0,-.42,0);const calf=new Builder();calf.mesh(profile([[.058,-.38],[.065,-.30],[.085,-.14],[.075,0],[.069,.035]]),'pants',0,0,0,1,1,.92);calf.rounded('darkWood',0,-.395,-.035,.17,.14,.28);calf.rounded('rubber',0,-.473,-.035,.175,.027,.29);for(let n=0;n<3;n++)calf.box('cream',0,-.36,-.11-n*.018,.075,.007,.007);knee.add(calf.batch(true));leg.add(knee);knees.push(knee);root.add(leg);limbs.push(leg);
  const arm=new THREE.Group();arm.position.set(side*.25,1.43,0);const a=new Builder();a.mesh(profile([[.067,-.31],[.077,-.21],[.086,-.08],[.07,.005],[.025,.045]]),shirt,side*.012,0,0,1,1,.92);a.mesh(profile([[.048,-.54],[.056,-.47],[.066,-.35],[.064,-.29]]),shirt,side*.017,0,-.012,1,1,.90);a.cyl('cream',side*.017,-.54,-.012,.05,.026);
  const hand=new Builder(),wrist=new THREE.Group();wrist.position.set(side*.017,-.55,-.012);hand.sphere(skin,0,-.046,-.010,.051,.074,.035);hand.sphere(skin,side*-.035,-.03,-.026,.018,.035,.021);for(let n=0;n<3;n++)hand.rounded(skin,(n-1)*.021,-.095,-.013,.017,.04,.027);
  if(style.articulated){arm.add(a.batch(true));wrist.add(hand.batch(true));arm.add(wrist);}else{hand.root.position.copy(wrist.position);a.root.add(hand.root);arm.add(a.batch(true));}wrists.push(wrist);root.add(arm);limbs.push(arm);
 }
 return {root,limbs,knees,head,wrists};
}
export function createTruck(){
 const b=new Builder();
 b.box('darkSteel',0,.55,0,1.65,.2,3.8);b.rounded('cream',0,.94,-1.23,1.84,.55,1.25);b.rounded('cream',0,1.31,-.23,1.86,.65,1.32);
 b.rounded('cream',0,1.94,-.12,1.84,.13,1.4);b.box('glass',0,1.64,-.79,1.59,.47,.035,-.12);b.box('glass',0,1.65,.54,1.57,.41,.04);
 for(const s of[-1,1]){b.box('glass',s*.932,1.65,-.12,.035,.44,1.1);for(const z of[-.75,.53])b.box('cream',s*.85,1.67,z,.12,.52,.1);b.box('darkSteel',s*.94,1.45,.3,.025,.05,.18);b.box('darkSteel',s*1.08,1.58,-.66,.24,.15,.14);b.box('cream',s*.82,.92,1.25,.22,.62,1.35);b.box('rust',s*.94,.74,1.3,.025,.11,.5);}
 b.box('wood',0,.7,1.3,1.5,.08,1.4);b.box('cream',0,.95,1.98,1.8,.53,.13);b.box('darkSteel',0,.58,2.1,1.95,.15,.15);b.box('steel',0,.58,-1.96,1.95,.16,.14);b.box('darkSteel',0,.83,-1.875,.9,.24,.04);
 for(let i=-.35;i<.4;i+=.13)b.box('steel',i,.83,-1.9,.025,.23,.02);
 for(const s of[-1,1]){b.box('cream',s*.66,.91,-1.88,.38,.22,.06);b.box('orange',s*.82,.77,-1.9,.14,.1,.05);b.box('orange',s*.74,1.02,2.06,.2,.22,.04);}
 const root=new THREE.Group();root.add(b.batch());const wheels:THREE.Group[]=[];
 for(const side of[-1,1])for(const z of[-1.2,1.3]){const wheel=new THREE.Group();wheel.position.set(side*.96,.48,z);const w=new Builder();w.cyl('rubber',0,0,0,.44,.3,0,0,Math.PI/2);w.cyl('steel',side*.16,0,0,.24,.025,0,0,Math.PI/2);w.cyl('darkSteel',side*.18,0,0,.10,.03,0,0,Math.PI/2);for(let i=0;i<8;i++){const a=i*Math.PI/4;w.box('rubber',0,Math.cos(a)*.43,Math.sin(a)*.43,.31,.06,.16,a);}wheel.add(w.batch());root.add(wheel);wheels.push(wheel);}
 const cargo=new THREE.Group();const cb=new Builder();for(const x of[-.38,.38])for(const z of[.9,1.6])barrel(cb,x,z,'rust',1.2);cargo.add(cb.batch());root.add(cargo);
 return {root,wheels,cargo};
}

function windowPanel(b:Builder,x:number,z:number,width:number,rotation=0){
 const panel=new Builder();panel.box('window',0,1.8,0,width,1.15,.035);for(const side of[-1,1])panel.box('cream',side*width/2,1.8,-.03,.08,1.3,.10);for(const y of[1.18,1.8,2.42])panel.box('cream',0,y,-.035,width+.15,.065,.10);panel.box('cream',0,1.8,-.035,.06,1.3,.10);panel.box('darkWood',0,1.14,0,width+.25,.09,.26);panel.root.position.set(x,0,z);panel.root.rotation.y=rotation;b.root.add(panel.root);
}
function wallWithWindows(b:Builder,mat:string,x:number,z:number,length:number,height:number,rotation=0){
 const wall=new Builder(),count=Math.max(1,Math.floor(length/3)),unit=length/count,windowWidth=Math.min(1.7,unit-.6);
 for(let i=0;i<count;i++){const cx=-length/2+unit*(i+.5),side=(unit-windowWidth)/2;wall.box(mat,cx, .57,0,unit,1.14,.24);wall.box(mat,cx,(height+2.45)/2,0,unit,height-2.45,.24);for(const sign of[-1,1])wall.box(mat,cx+sign*(windowWidth/2+side/2),1.795,0,side,1.31,.24);windowPanel(wall,cx,0,windowWidth);}
 wall.root.position.set(x,0,z);wall.root.rotation.y=rotation;b.root.add(wall.root);
}
function buildTownBuilding(b:Builder,def:TownBuilding){
 const {x,z,w,d,height:h}=def,front=def.front==='south'?1:-1,frontZ=z+front*d/2,backZ=z-front*d/2;
 b.box('concrete',x,.015,z,w+.35,.06,d+.35);b.box(def.kind==='house'?'wood':'concrete',x,.055,z,w-.25,.04,d-.25);
 if(def.kind==='house')for(let sx=-w/2+.4;sx<w/2;sx+=.5)b.box('darkWood',x+sx,.079,z,.012,.005,d-.4);
 wallWithWindows(b,def.wall,x-w/2,z,d,h,Math.PI/2);wallWithWindows(b,def.wall,x+w/2,z,d,h,-Math.PI/2);wallWithWindows(b,def.wall,x,backZ,w,h,front===1?0:Math.PI);
 const side=(w-def.doorWidth)/2;
 for(const sign of[-1,1])wallWithWindows(b,def.wall,x+sign*(def.doorWidth/2+side/2),frontZ,side,h,front===1?0:Math.PI);
 b.box(def.wall,x,(h+2.65)/2,frontZ,def.doorWidth,h-2.65,.24);
 for(const sign of[-1,1])b.box('cream',x+sign*(def.doorWidth/2+.045),1.36,frontZ,.10,2.72,.31);b.box('cream',x,2.73,frontZ,def.doorWidth+.2,.10,.31);
 for(const sx of[-1,1])for(const sz of[-1,1])b.box('cream',x+sx*w/2,h/2,z+sz*d/2,.17,h,.17);
 const roof=new Builder(),rise=w*.24,angle=Math.atan2(rise,w/2);
 roof.box('white',x,h-.08,z,w-.22,.08,d-.22);
 for(const sign of[-1,1]){roof.box(def.roof,x+sign*w/4,h+rise/2+.05,z,w*.57,.14,d+.8,0,0,-sign*angle);roof.box('cream',x+sign*(w/2+.17),h+.02,z,.12,.18,d+.85);}
 for(const end of[-1,1]){const shape=new THREE.Shape();shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(0,rise);shape.closePath();const geo=new THREE.ShapeGeometry(shape),mesh=new THREE.Mesh(geo,getMaterials()[def.wall]);mesh.position.set(x,h,z+end*d/2);if(end<0)mesh.rotation.y=Math.PI;roof.root.add(mesh);for(const sign of[-1,1])roof.beam('cream',new THREE.Vector3(x+sign*(w/2+.2),h,z+end*(d/2+.4)),new THREE.Vector3(x,h+rise+.1,z+end*(d/2+.4)),.12);}
 if(def.kind==='house'){
  roof.box('brick',x+w*.28,h+1,z-d*.2,.55,2,.55);roof.box('darkSteel',x+w*.28,h+2.04,z-d*.2,.7,.10,.7);
  b.box('wood',x,.06,frontZ+front*.9,w*.72,.08,1.7);for(const sign of[-1,1])b.box('cream',x+sign*w*.34,1.3,frontZ+front*1.5,.13,2.6,.13);
  roof.box(def.roof,x,2.73,frontZ+front*.85,w*.8,.12,2.1,-front*.08);
  b.label(def.name,x,2.3,frontZ+front*.17,1.4,.23,front===1?0:Math.PI,'#33463a','#efe4c7');
 }else{
  b.label(def.name,x,h-.45,frontZ+front*.18,Math.min(w-.6,8),.68,front===1?0:Math.PI,'#284439','#eedfbb');
  const awning=new Builder();awning.box('darkRoof',x,2.85,frontZ+front*.75,w+.3,.12,1.6,-front*.10);for(let sx=-w/2;sx<w/2;sx+=.45)awning.box('cream',x+sx,2.87,frontZ+front*.75,.18,.015,1.55,-front*.10);roof.root.add(awning.root);
 }
 return roof.batch();
}
function shelf(b:Builder,x:number,z:number,width:number,rotation=0){
 const s=new Builder();for(const side of[-1,1])s.box('darkSteel',side*width/2,1.15,0,.055,2.3,.65);
 for(let y=.3;y<2.3;y+=.55){s.box('wood',0,y,0,width,.065,.65);for(let n=0;n<Math.floor(width/.4);n++){const sx=-width/2+.25+n*.4,style=(n+Math.round(y*4))%4;s.box(style===0?'cream':style===1?'shirtRed':style===2?'sage':'yellow',sx,y+.19,.02,.27,.31,.32);s.box('white',sx,y+.20,.187,.14,.11,.01);}}
 s.root.position.set(x,0,z);s.root.rotation.y=rotation;b.root.add(s.root);
}
function counter(b:Builder,x:number,z:number,width:number,rotation=0){const c=new Builder();c.box('wood',0,.5,0,width,1,.65);for(let n=-width/2+.15;n<width/2;n+=.22)c.box('darkWood',n,.5,.335,.018,.91,.012);c.box('darkWood',0,1.04,0,width+.1,.10,.75);c.rounded('darkSteel',width*.3,1.16,0,.42,.2,.35);c.box('cream',width*.3,1.29,-.06,.35,.025,.22);c.root.position.set(x,0,z);c.root.rotation.y=rotation;b.root.add(c.root);}
function furnishedHouse(b:Builder,house:TownBuilding){
 const bedX=house.x-house.w/2+1.2,bedZ=house.z-1.2;b.box('darkWood',bedX,.28,bedZ,1.5,.5,2.5);b.rounded('white',bedX,.57,bedZ,1.4,.2,2.3);b.rounded('sage',bedX,.69,bedZ+.35,1.38,.07,1.45);b.rounded('cream',bedX,.72,bedZ-.78,1.06,.16,.43);b.box('wood',bedX,.75,bedZ-1.23,1.5,1.3,.1);
 const tx=house.x+1.6,tz=house.z-1.6;b.box('wood',tx,.75,tz,1.7,.09,1.1);for(const sx of[-.65,.65])for(const sz of[-.4,.4])b.box('darkWood',tx+sx,.38,tz+sz,.08,.74,.08);b.cyl('cream',tx,.83,tz,.18,.025);b.cyl('shirtRed',tx+.38,.91,tz,.07,.16);b.box('cream',tx-.4,.82,tz,.35,.02,.23);
 const sx=house.x+1.5,sz=house.z+1.7;b.rounded('shirtBlue',sx,.4,sz,1.2,.6,.7);b.rounded('shirtBlue',sx,.8,sz+.3,1.2,.6,.16);b.rounded('cream',sx-.3,.69,sz+.04,.29,.12,.26);b.box('rug',house.x,.085,house.z+.6,2.1,.012,1.8);
 b.label('HOME IN WORLDO',house.x+house.w/2-.15,2.1,house.z,.9,.55,-Math.PI/2,'#eee2bf','#59715a');
}
function hose(b:Builder,x:number,z:number){const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x+.45,1.35,z),new THREE.Vector3(x+.75,1,z+.06),new THREE.Vector3(x+.78,.35,z+.08),new THREE.Vector3(x+.52,.28,z+.08),new THREE.Vector3(x+.48,.95,z+.08)]);const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,12,.035,5,false),getMaterials().rubber);mesh.castShadow=true;b.root.add(mesh);b.box('darkSteel',x+.47,1,z+.08,.1,.32,.1,0,0,-.15);}

export function createEnvironment(){
 const b=new Builder(),sceneGroup=new THREE.Group(),doorGroups=new Map<string,THREE.Group>();
 // Every traversable coordinate is exactly level. Raised land starts beyond the world boundary.
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(520,520,1,1),getMaterials().grass);ground.rotation.x=-Math.PI/2;ground.position.y=-.025;ground.receiveShadow=true;sceneGroup.add(ground);
 const hills=new Builder();for(let i=0;i<18;i++){const angle=i/18*Math.PI*2,r=(151+(i%3)*13)/Math.max(Math.abs(Math.sin(angle)),Math.abs(Math.cos(angle)));hills.sphere(i%2?'foliage':'foliageLight',Math.sin(angle)*r,6,Math.cos(angle)*r,28,15+(i%4)*4,24);}sceneGroup.add(hills.batch());
 for(const [ax,az,bx,bz,width]of ROADS){const dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz),angle=Math.atan2(dx,dz);b.box('dirt',(ax+bx)/2,-.005,(az+bz)/2,width+1.2,.03,length+.4,0,angle);b.box('road',(ax+bx)/2,.012,(az+bz)/2,width,.025,length+.3,0,angle);if(width>=6)for(let t=4;t<length-3;t+=5)b.box('cream',ax+dx*t/length,.028,az+dz*t/length,.065,.008,1.8,0,angle);}
 // Rooms stay enclosed. The camera moves below ceilings and through door apertures.
 for(const building of TOWN_BUILDINGS){sceneGroup.add(buildTownBuilding(b,building));if(building.kind==='house')furnishedHouse(b,building);}
 for(const door of TOWN_DOORS){const leaf=new Builder(),isHouse=door.buildingId.includes('house');leaf.box(isHouse?'wood':'darkRoof',door.width/2,.58,0,door.width,1.16,.12);leaf.box(isHouse?'wood':'darkRoof',door.width/2,2.52,0,door.width,.16,.12);for(const sx of[.07,door.width-.07])leaf.box(isHouse?'wood':'darkRoof',sx,1.8,0,.14,1.28,.12);leaf.box('window',door.width/2,1.8,0,door.width-.28,1.28,.035);for(const y of[1.18,2.42])leaf.box('cream',door.width/2,y,.082,door.width-.2,.045,.03);leaf.box('steel',door.width-.18,1.05,.13,.035,.23,.06);const group=leaf.batch();group.position.set(door.hinge.x,0,door.hinge.z);doorGroups.set(door.id,group);sceneGroup.add(group);}
 counter(b,-2,4.2,4.3);shelf(b,-5,4.3,5,Math.PI/2);shelf(b,5,4.3,5,-Math.PI/2);shelf(b,0,1,5.7);b.label('TOOLS  /  MAPS  /  PROVISIONS',0,2.9,1,5,.42);
 counter(b,48,-27.6,3.4);shelf(b,52.8,-31.5,3,Math.PI/2);b.label('CONTROL ROOM',50,2.7,-33.7,3.3,.6);for(let i=0;i<4;i++){b.box('darkSteel',47+i*.55,1.5,-33.7,.43,.75,.18);b.cyl(i%2?'sage':'orange',47+i*.55,1.6,-33.57,.06,.025,Math.PI/2);}
 counter(b,-41,-25.5,3.2);shelf(b,-47.5,-30,3.5,Math.PI/2);b.label('LUMBER  /  MILLING',-44,2.9,-34.7,4,.5);
 counter(b,37,45.5,3.2,Math.PI);shelf(b,43,50,3.5);b.label('IRONWORK  /  FABRICATION',40,3,53.7,5,.6,Math.PI);
 // A proper roadside filling station, with working-height pumps, hoses and shelter.
 b.box('concrete',9.65,.018,15.5,8.5,.03,12);for(const x of[5.8,13.5])for(const z of[10,21]){b.box('cream',x,2,z,.25,4,.25);b.box('darkRoof',x,.4,z,.26,.8,.26);}
 b.box('darkRoof',9.65,4.06,15.5,8.8,.32,12.2);b.box('cream',9.65,4.23,15.5,9,.055,12.4);b.label('WORLDO  /  FUEL & SERVICE',9.65,4.06,21.65,8.1,.45);b.label('PETROL',5.21,4.06,15.5,5,.45,-Math.PI/2);
 for(const pump of FUEL_PUMPS){const {x,z}=pump.position;b.rounded('concrete',x,.055,z,1.1,.1,.7);b.rounded('darkRoof',x,.5,z,.85,.9,.6);b.rounded('cream',x,1.31,z,.9,.72,.63);b.box('black',x,1.45,z+.326,.63,.23,.015);b.label('PETROL',x,1.13,z+.335,.64,.18,0,'#ece7d5','#284439');b.label('95',x,1.45,z+.344,.23,.14,0,'#242a25','#b8d4ac');hose(b,x,z);}
 // Refinery pipework connects recognisable storage tanks and a moving pumping arm.
 b.box('concrete',53,.015,-29,29,.025,26);tank(b,TANKS.east,7);tank(b,TANKS.north,7);tank(b,TANKS.west,5.5);
 for(const z of[-34,-24]){b.box('steel',56,3.7,z,16,.16,.2);for(const x of[49,63]){b.box('steel',x,2,z,.18,4,.18);}}
 for(const x of[56,57,58]){b.cyl('rust',x,3.9,-28,.12,17,Math.PI/2);b.cyl('steel',x,2,-19.7,.12,3.8);}
 for(const x of[47,53]){b.cyl('brick',x,7,-39,.62,14);for(let y=3;y<14;y+=2)b.cyl('cream',x,y,-39,.63,.48);b.cyl('darkSteel',x,14.05,-39,.74,.22);}
 b.box('concrete',56,.08,-34,1.6,.16,1.3);for(const side of[-1,1])b.beam('darkSteel',new THREE.Vector3(56+side*.65,.15,-34),new THREE.Vector3(56,1.9,-34),.16);b.cyl('steel',56,1.9,-34,.18,.55,Math.PI/2);
 const pumpArm=new THREE.Group(),pa=new Builder();pa.box('yellow',0,0,0,4,.20,.28);pa.rounded('darkSteel',-1.8,-.27,0,.6,.8,.4);pumpArm.add(pa.batch());pumpArm.position.set(56,1.9,-34);sceneGroup.add(pumpArm);
 // Sawmill and foundry exterior machinery complements their staffed interiors.
 b.box('dirt',-44,-.005,-28,27,.025,24);b.box('darkSteel',-34,.48,-30,2,.9,3.5);b.box('wood',-34,1.04,-30,2.2,.1,3.7);
 const saw=new THREE.Mesh(new THREE.CylinderGeometry(.48,.48,.055,24),getMaterials().steel);saw.rotation.z=Math.PI/2;saw.position.set(-34,1.17,-30);sceneGroup.add(saw);
 b.box('concrete',40,.012,48,27,.025,22);b.box('darkSteel',48,.8,49,2,1.6,3);b.box('orange',48,1.15,47.48,1.1,.6,.02);b.cyl('darkSteel',48,5.8,51,.55,11.6);b.cyl('rust',48,11.65,51,.7,.2);
 // A working drill head gives the ridge activity without exposing a private deposit.
 b.box('dirt',26,0,-68,15,.02,13);for(const sx of[-1,1])for(const sz of[-1,1])b.beam('yellow',new THREE.Vector3(29+sx*1.35,0,-69+sz*1.35),new THREE.Vector3(29+sx*.35,8,-69+sz*.35),.13);
 for(let y=1;y<8;y+=1.4){const r=1.35-y*.125;for(const sign of[-1,1])b.beam('yellow',new THREE.Vector3(29-r,y,-69+sign*r),new THREE.Vector3(29+r-.175,y+1.4,-69+sign*(r-.175)),.07);}
 b.box('darkSteel',29,.4,-69,3,.8,3);b.box('yellow',32,1,-69,2.2,2,2.2);const drill=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,6,8),getMaterials().steel);drill.position.set(29,3.5,-69);sceneGroup.add(drill);b.label('NORTH RIDGE / SURVEY AREA',25,2.3,-61.5,5,.65);
 b.label('STONECUT QUARRY',67,2.3,31,4.7,.7);b.box('yellow',73,.75,34,3,1.5,2);b.box('glass',73,1.6,34,1.3,.9,1.3);b.beam('yellow',new THREE.Vector3(73,1.8,33),new THREE.Vector3(76,3.2,31),.25);
 b.box('dirt',-37,0,44,17,.025,14);b.label('RIVERSIDE / BUILDING PLOT',-37,2.3,38,4.8,.6);
 // Solid scenery uses the same deterministic footprints as authoritative movement.
 for(const tree of TOWN_TREES){b.cyl('trunk',tree.x,tree.height*.28,tree.z,tree.radius,tree.height*.56);if(tree.type==='pine'){for(let n=0;n<3;n++)b.cone(n%2?'foliage':'foliageDark',tree.x,tree.height*(.43+n*.18),tree.z,tree.height*(.30-n*.065),tree.height*.48);}else{for(let n=0;n<5;n++){const angle=n/5*Math.PI*2;b.sphere(n%2?'foliageLight':'foliage',tree.x+Math.sin(angle)*.85,tree.height*.72+(n%2)*.6,tree.z+Math.cos(angle)*.85,tree.height*.24,tree.height*.22,tree.height*.24);}b.beam('trunk',new THREE.Vector3(tree.x,tree.height*.4,tree.z),new THREE.Vector3(tree.x+.7,tree.height*.65,tree.z),tree.radius*.7);}}
 for(const rock of TOWN_ROCKS){const mesh=b.mesh(new THREE.DodecahedronGeometry(1,0),'stone',rock.x,rock.height/2,rock.z,rock.w/2,rock.height/2,rock.d/2,0,rock.rotation,0);mesh.castShadow=true;}
 for(const f of TOWN_FENCES)fence(b,f.x,f.z,f.length,f.axis==='x'?0:-Math.PI/2);
 for(const p of TOWN_PROPS){if(p.kind==='barrel')barrel(b,p.x,p.z,'rust');else if(p.kind==='crate')crate(b,p.x,p.z,p.w,p.height/2);else if(p.kind==='bench'){b.box('wood',p.x,.45,p.z,p.w,.12,p.d);b.box('wood',p.x,.78,p.z+.28,p.w,.6,.12);for(const side of[-1,1])b.box('darkSteel',p.x+side*p.w*.36,.22,p.z,.07,.45,p.d*.8);}else if(p.kind==='planter'){b.box('wood',p.x,.3,p.z,p.w,.6,p.d);b.box('dirt',p.x,.61,p.z,p.w-.12,.04,p.d-.12);for(let n=0;n<4;n++)b.sphere('foliage',p.x+(n%2-.5)*.4,.8,p.z+(Math.floor(n/2)-.5)*.3,.3,.3,.3);}else if(p.kind==='timber'){for(let row=0;row<3;row++)for(let n=0;n<4-row;n++)b.cyl('trunk',p.x+(n-(3-row)/2)*.6,.3+row*.5,p.z,.29,p.d,Math.PI/2);}}
 for(const p of TOWN_LAMPS)lamp(b,p.x,p.z,Math.PI/2);
 const grass=new Builder(),r=randomGenerator(3932),blade=new THREE.BufferGeometry();blade.setAttribute('position',new THREE.Float32BufferAttribute([-.04,0,0,.04,0,0,0,.42,0],3));blade.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1],2));blade.computeVertexNormals();getMaterials().foliage.side=THREE.DoubleSide;
 for(let i=0;i<1400;i++){const x=(r()-.5)*194,z=(r()-.5)*194;if(TOWN_BUILDINGS.some(v=>Math.abs(x-v.x)<v.w/2+4&&Math.abs(z-v.z)<v.d/2+4)||Math.hypot(x,z)<30)continue;const nearRoad=ROADS.some(([ax,az,bx,bz,w])=>{const dx=bx-ax,dz=bz-az,t=THREE.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);return Math.hypot(x-ax-t*dx,z-az-t*dz)<w/2+1;});if(!nearRoad)grass.mesh(blade,'foliage',x,0,z,1,.6+r(),1,0,r()*Math.PI,0);}
 sceneGroup.add(b.batch(),grass.batch());
 const facilityBuilder=new Builder();tank(facilityBuilder,{x:-37,z:44,r:1.7},3.6);facilityBuilder.box('rust',-32,1,44,2,2,3);facilityBuilder.cyl('steel',-35,1,44,.1,5,0,0,Math.PI/2);const facility=facilityBuilder.batch();facility.visible=false;sceneGroup.add(facility);
 const sellers=SERVICE_NPCS.map((npc,i)=>{const character=createCharacter({...npc,hat:i===1||i===4,backpack:false,articulated:true});character.root.position.set(npc.position.x,0,npc.position.z);character.root.rotation.y=npc.heading;sceneGroup.add(character.root);return{...character,npc,phase:i*1.7};});
 const residents=TOWN_RESIDENTS.map((npc,i)=>{const character=createCharacter({...npc,hat:!!npc.carrying,backpack:false});character.root.position.set(npc.route[0].x,0,npc.route[0].z);if(npc.carrying){const prop=new Builder();if(npc.carrying==='box')prop.box('wood',0,1.02,-.45,.55,.43,.4);else if(npc.carrying==='timber')prop.box('wood',.12,1.46,-.03,.3,.22,1.9);else{prop.box('darkSteel',.32,.74,-.16,.24,.24,.16);prop.box('steel',.32,.93,-.16,.2,.05,.03);}character.root.add(prop.batch(true));}sceneGroup.add(character.root);return{...character,npc,waypoint:1,pause:i*.6,cycle:i,blocked:0};});
 // These elevated volumes affect the lens only, never authoritative movement.
 const cameraStructures:CameraCollider[]=TOWN_BUILDINGS.flatMap(building=>{
  const front=building.front==='south'?1:-1,frontZ=building.z+front*building.d/2;
  return[
   {x:building.x,z:building.z,w:building.w+.8,d:building.d+.8,bottom:building.height-.12,height:building.height+building.w*.24+.25},
   {x:building.x,z:frontZ,w:building.doorWidth,d:.24,bottom:2.65,height:building.height},
   {x:building.x,z:frontZ+front*.8,w:building.kind==='house'?building.w*.8:building.w+.3,d:building.kind==='house'?2.1:1.6,bottom:2.57,height:3.05},
  ];
 });
 cameraStructures.push({x:9.65,z:15.5,w:9,d:12.4,bottom:3.88,height:4.28});
 for(const shelf of[{x:-5,z:4.3,w:.75,d:5},{x:5,z:4.3,w:.75,d:5},{x:0,z:1,w:5.7,d:.65},{x:52.8,z:-31.5,w:.65,d:3},{x:-47.5,z:-30,w:.65,d:3.5},{x:43,z:50,w:3.5,d:.65}])cameraStructures.push({...shelf,height:2.35});
 let openDoors=new Set<string>(),colliders=getWorldColliders(openDoors);
 return{group:sceneGroup,facility,get colliders(){return colliders;},getColliders:()=>colliders,getCameraColliders:():readonly CameraCollider[]=>[
  ...colliders.slice(0,-TOWN_DOORS.length),...cameraStructures,
  ...TOWN_DOORS.map(door=>{const rotation=doorGroups.get(door.id)!.rotation.y;return{x:door.hinge.x+Math.cos(rotation)*door.width/2,z:door.hinge.z-Math.sin(rotation)*door.width/2,w:door.width,d:.18,height:2.65,rotation};}),
 ],getNpcColliders:():readonly Collider[]=>residents.map(actor=>({x:actor.root.position.x,z:actor.root.position.z,w:.6,d:.6,height:1.8,kind:'npc',id:actor.npc.id})),getInterior:getTownInterior,
  setDoors(value:ReadonlySet<string>|readonly string[]|Record<string,boolean>){openDoors=value instanceof Set?new Set(value):Array.isArray(value)?new Set(value):new Set(Object.entries(value).filter(([,open])=>open).map(([id])=>id));colliders=getWorldColliders(openDoors);},
  tick(dt:number,elapsed:number,player:Vec2,truck?:{position:Vec2;heading:number}){
   // Roofs remain visible indoors and out; hiding them breaks threshold views.
   for(const [id,door]of doorGroups)door.rotation.y=THREE.MathUtils.damp(door.rotation.y,openDoors.has(id)?Math.PI/2:0,7,dt);
   pumpArm.rotation.z=Math.sin(elapsed*1.7)*.24;saw.rotation.x+=dt*8;drill.position.y=3.5+Math.sin(elapsed*2)*.15;
   for(const s of sellers){
    const distance=Math.hypot(s.npc.position.x-player.x,s.npc.position.z-player.z);s.root.visible=distance<65;if(!s.root.visible)continue;
    const time=elapsed+s.phase,look=distance<6?Math.atan2(-(player.x-s.npc.position.x),-(player.z-s.npc.position.z))-s.npc.heading:Math.sin(time*.35)*.28;
    const headTurn=THREE.MathUtils.clamp(Math.atan2(Math.sin(look),Math.cos(look)),-.65,.65);
    s.head.rotation.y=THREE.MathUtils.damp(s.head.rotation.y,headTurn,3,dt);s.head.rotation.x=Math.sin(time*.9)*.045;s.head.rotation.z=Math.sin(time*.6)*.035;
    const gesture=Math.pow(Math.max(0,Math.sin(time*.65)),4)*(distance<6?.38:.13);
    s.limbs[1].rotation.x=.12+Math.sin(time*.8)*.07+gesture;s.limbs[3].rotation.x=.14+Math.sin(time*.6)*.08;
    s.limbs[1].rotation.z=.04+gesture*.35;s.limbs[3].rotation.z=-.04-Math.sin(time*.5)*.035;
    s.wrists[0].rotation.z=Math.sin(time*1.2)*.08+gesture*.45;s.wrists[1].rotation.x=Math.sin(time*.75)*.12;
    s.root.rotation.z=Math.sin(time*.55)*.009;s.root.position.y=Math.sin(time*1.5)*.008;
   }
   for(const actor of residents){actor.root.visible=Math.hypot(actor.root.position.x-player.x,actor.root.position.z-player.z)<70;let moving=false;
    if(actor.pause>0)actor.pause-=dt;else{const target=actor.npc.route[actor.waypoint],dx=target.x-actor.root.position.x,dz=target.z-actor.root.position.z,distance=Math.hypot(dx,dz);if(distance<.18){actor.waypoint=(actor.waypoint+1)%actor.npc.route.length;actor.pause=actor.npc.pause;actor.blocked=0;}else{const step=Math.min(distance,actor.npc.speed*dt),nx=actor.root.position.x+dx/distance*step,nz=actor.root.position.z+dz/distance*step;const blocked=colliders.some(c=>Math.abs(nx-c.x)<c.w/2+.22&&Math.abs(nz-c.z)<c.d/2+.22)||Math.hypot(nx-player.x,nz-player.z)<.75||(truck!==undefined&&bodyCollides({x:nx,z:nz},0,false,[{x:truck.position.x,z:truck.position.z,w:VEHICLE_HALF_WIDTH*2,d:VEHICLE_HALF_LENGTH*2,rotation:truck.heading}]));if(!blocked){actor.root.position.x=nx;actor.root.position.z=nz;moving=true;actor.blocked=0;}else{actor.blocked+=dt;if(actor.blocked>1){actor.waypoint=(actor.waypoint+1)%actor.npc.route.length;actor.blocked=0;}}actor.root.rotation.y=Math.atan2(-dx,-dz);}}
    actor.cycle+=moving?dt*actor.npc.speed*5:0;for(let i=0;i<actor.limbs.length;i++){const walking=Math.sin(actor.cycle+(i<2?0:Math.PI))*(i%2===0?.42:.35)*(i%2===0?1:-1);actor.limbs[i].rotation.x=THREE.MathUtils.damp(actor.limbs[i].rotation.x,moving?walking:0,8,dt);}if(actor.npc.carrying==='box')actor.limbs[1].rotation.x=actor.limbs[3].rotation.x=1.1;else if(actor.npc.carrying==='timber')actor.limbs[3].rotation.x=1.8;
    actor.knees.forEach((knee,index)=>{knee.rotation.x=THREE.MathUtils.damp(knee.rotation.x,moving?-Math.max(0,-Math.sin(actor.cycle+index*Math.PI))*.65:0,9,dt);});
    if(!moving&&actor.npc.work)actor.limbs[3].rotation.x=actor.npc.work==='hammer'?.8+Math.sin(elapsed*4)*.55:.5+Math.sin(elapsed*1.7)*.25;
   }
  }
 };
}

export function disposeAssets(){for(const m of Object.values(materials)){m.map?.dispose();m.dispose();}for(const k of Object.keys(materials))delete materials[k];}
