import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PLACES } from '../../shared/types';
import {BUILDINGS,TANKS,COUNTERS,ROADS,WORLD_COLLIDERS,type Footprint,type TankFootprint} from '../../shared/world-layout';

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
 const definitions:Record<string,[string,number,number]>={concrete:['#a59f8c',.96,0],wall:['#d1c5ac',.91,0],roof:['#647473',.85,.3],darkRoof:['#3b4947',.9,.3],wood:['#86714f',.97,0],darkWood:['#594d39',.99,0],rust:['#91674b',.83,.3],steel:['#8c9993',.57,.5],darkSteel:['#434a43',.66,.65],cream:['#d7d4bd',.72,.3],yellow:['#c49b44',.73,.25],orange:['#b66c3f',.8,.2],black:['#242a25',.96,0],rubber:['#272a27',1,0],glass:['#779c9f',.3,.2],foliage:['#526c38',1,0],foliageLight:['#70834a',1,0],foliageDark:['#354e30',1,0],trunk:['#696047',1,0],stone:['#898b7a',1,0],stoneLight:['#aaa795',1,0],skin:['#b58a68',.93,0],jacket:['#596052',.95,0],pants:['#444e4b',.95,0],bag:['#8a7959',.95,0],road:['#7d7c70',1,0],dirt:['#a39672',1,0],grass:['#8e9560',1,0]};
 for(const [key,[color,roughness,metalness]] of Object.entries(definitions))materials[key]=new THREE.MeshStandardMaterial({color,roughness,metalness});
 for(const key of ['concrete','wall']){materials[key].map=texture('concrete','#ffffff');}
 for(const key of ['roof','darkRoof','cream'])materials[key].map=texture('metal','#ffffff');
 for(const key of ['wood','darkWood'])materials[key].map=texture('wood','#ffffff');
 materials.grass.map=texture('ground','#d3d0b5');materials.grass.map.repeat.set(75,75);
 materials.dirt.map=texture('ground','#ddd2b4');materials.dirt.map.repeat.set(2,2);
 materials.road.map=texture('road','#d1cec4');materials.road.map.repeat.set(1,1);
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
 batch(){
  this.root.updateMatrixWorld(true);const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();const extra:THREE.Object3D[]=[];
  this.root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const mat=o.material as THREE.Material;const g=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrixWorld);if(mat===materials.road||mat===materials.dirt||mat===materials.concrete||mat===materials.wall){const p=g.attributes.position,n=g.attributes.normal,u=g.attributes.uv;for(let i=0;i<p.count;i++){const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i)),az=Math.abs(n.getZ(i));u.setXY(i,(ay>ax&&ay>az?p.getX(i):ax>az?p.getZ(i):p.getX(i))*.35,(ay>ax&&ay>az?p.getZ(i):p.getY(i))*.35);}}if(!batches.has(mat))batches.set(mat,[]);batches.get(mat)!.push(g);});
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

export function createCharacter(){
 const root=new THREE.Group(),body=new Builder();
 const torso=new THREE.LatheGeometry([new THREE.Vector2(.19,.86),new THREE.Vector2(.21,.95),new THREE.Vector2(.175,1.06),new THREE.Vector2(.20,1.22),new THREE.Vector2(.245,1.35),new THREE.Vector2(.23,1.43),new THREE.Vector2(.10,1.51)],16);
 body.mesh(torso,'jacket',0,0,0,1,1,.69);body.rounded('pants',0,.86,0,.39,.17,.29);body.box('darkSteel',0,.9,0,.40,.045,.30);body.box('steel',0,.90,-.155,.07,.05,.02);
 body.rounded('bag',0,1.22,.22,.37,.45,.20);body.rounded('darkWood',0,1.16,.33,.29,.23,.07);body.box('bag',0,1.29,.35,.29,.04,.025);for(const x of[-.16,.16])body.box('bag',x,1.26,-.18,.05,.48,.035);
 for(const x of[-.11,.11])body.rounded('darkWood',x,1.25,-.176,.14,.14,.025);body.box('darkSteel',0,1.17,-.176,.015,.48,.02);
 body.cyl('skin',0,1.55,0,.085,.16);body.sphere('skin',0,1.72,-.015,.135,.185,.14);body.sphere('darkWood',0,1.77,.035,.14,.135,.115);body.sphere('jacket',0,1.85,0,.151,.065,.16);body.rounded('jacket',0,1.83,-.17,.25,.025,.17);for(const x of[-.14,.14])body.sphere('skin',x,1.71,0,.026,.044,.028);body.sphere('skin',0,1.70,-.16,.026,.035,.035);
 for(const x of[-.055,.055])body.sphere('black',x,1.74,-.15,.012,.012,.008);body.box('skin',0,1.68,-.154,.06,.04,.026);
 root.add(body.batch());
 const limbs:THREE.Group[]=[];
 for(const side of[-1,1]){
  const leg=new THREE.Group();leg.position.set(side*.13,.9,0);const l=new Builder();l.cyl('pants',0,-.22,0,.103,.46);l.cyl('pants',0,-.63,.01,.092,.39);l.rounded('black',0,-.84,-.04,.19,.13,.32);l.box('darkSteel',0,-.9,-.04,.19,.025,.33);l.rounded('jacket',side*.09,-.21,.01,.035,.18,.12);leg.add(l.batch());root.add(leg);limbs.push(leg);
  const arm=new THREE.Group();arm.position.set(side*.29,1.44,0);const a=new Builder();a.sphere('jacket',0,-.04,0,.105,.13,.11);a.cyl('jacket',side*.025,-.2,0,.085,.36);a.cyl('jacket',side*.025,-.44,-.02,.072,.22);a.sphere('skin',side*.025,-.61,-.045,.069,.105,.065);arm.add(a.batch());root.add(arm);limbs.push(arm);
 }
 return {root,limbs};
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

export function createEnvironment(){
 const b=new Builder(),m=getMaterials();
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(520,520,64,64),m.grass);ground.rotation.x=-Math.PI/2;ground.position.y=-.12;ground.receiveShadow=true;
 const p=ground.geometry.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getY(i),dist=Math.hypot(x,z),fade=THREE.MathUtils.smoothstep(dist,105,155);if(dist>100)p.setZ(i,fade*(18+Math.sin(x*.035)*Math.cos(z*.04)*14+Math.sin(x*.08+z*.06)*5));}ground.geometry.computeVertexNormals();
 const roadSegments:{ax:number;az:number;bx:number;bz:number;width:number}[]=[];
 for(const [x1,z1,x2,z2,w]of ROADS){const dx=x2-x1,dz=z2-z1,len=Math.hypot(dx,dz),angle=Math.atan2(dx,dz);b.box('dirt',(x1+x2)/2,-.03,(z1+z2)/2,w+1.8,.08,len+1,0,angle);b.box('road',(x1+x2)/2,.014,(z1+z2)/2,w,.055,len+.3,0,angle);roadSegments.push({ax:x1,az:z1,bx:x2,bz:z2,width:w});if(w>=6){for(let s=10;s<len-8;s+=6)b.box('cream',x1+dx*s/len,.045,z1+dz*s/len,.08,.01,2.2,0,angle);}}
 // Depot is a walk-in street-front workshop, with its counter at the marked interaction point.
 warehouse(b,BUILDINGS.depot,4.5,'wall','darkRoof');b.box('black',0,1.75,9.53,4,3.1,.04);b.box('rust',0,3.6,11.2,10,.16,3,0,0,.01);
 for(const x of[-4.6,4.6])b.box('darkSteel',x,1.8,12.5,.12,3.6,.12);
 b.label('LOWLAND SUPPLY CO.',0,4.15,9.58,9,1.2);b.label('TOOLS · FUEL · PROVISIONS',0,2.8,9.65,3.7,.55);
 b.box('wood',COUNTERS.depot.x,.64,COUNTERS.depot.z,2.8,1.28,.8);b.box('darkSteel',COUNTERS.depot.x,1.3,COUNTERS.depot.z,3,.1,.85);
 for(const x of[-1.4,1.4]){b.box('darkSteel',x,1.5,9.65,.05,2.7,.3);for(let y=.4;y<2.9;y+=.65){b.box('wood',0,y,9.75,3,.07,.5);for(let n=0;n<5;n++)b.rounded(n%2?'rust':'cream',-1.1+n*.5,y+.22,9.84,.27,.4,.28);}}
 for(let i=0;i<4;i++){barrel(b,5.5+i%2*.75,10+Math.floor(i/2)*.8,i%2?'cream':'rust');crate(b,-5.4+i%2,10+Math.floor(i/2),.8);}
 b.box('concrete',0,.05,11,14,.16,5);
 const depotNpc=createCharacter();depotNpc.root.position.set(-1.7,0,10.8);depotNpc.root.rotation.y=Math.PI;b.root.add(depotNpc.root);
 // Refinery, process equipment, tanks, overhead pipe rack and pump station.
 b.box('concrete',53,.03,-27,28,.16,23);warehouse(b,BUILDINGS.refinery,4,'roof','darkRoof');
 tank(b,TANKS.east,7);tank(b,TANKS.north,7);tank(b,TANKS.west,5.5);
 for(const x of[47,53]){b.cyl('rust',x,7,-38,.65,14);for(let y=2;y<14;y+=2)b.cyl('cream',x,y,-38,.66,.55);b.cyl('darkSteel',x,14,-38,.78,.25);}
 for(const z of[-34,-24]){b.box('steel',54,3,z,18,.15,.2);for(const x of[46,62])b.box('steel',x,1.5,z,.15,3,.15);}
 for(const x of[52,53,54])b.cyl('rust',x,3.2,-28,.15,17,Math.PI/2);b.label('LOWLAND REFINERY',48,3.3,-19.8,8,.9);for(const x of[44,52])b.box('darkSteel',x,1.7,-20,.12,3.4,.12);
 b.box('wood',COUNTERS.refinery.x,.7,COUNTERS.refinery.z,3.4,1.4,.85);b.box('steel',COUNTERS.refinery.x,1.45,COUNTERS.refinery.z,3.6,.1,.95);
 b.box('darkSteel',40,1,-18,.75,2,.75);b.box('cream',40,1.85,-17.6,.63,.3,.05);b.label('FUEL',40,2.55,-17.6,1.5,.5);
 const refNpc=createCharacter();refNpc.root.position.set(45,0,-21);refNpc.root.rotation.y=Math.PI;b.root.add(refNpc.root);
 // Sawmill: open timber yard, stacked lumber and sawing shed.
 b.box('dirt',-44,0,-25,23,.1,23);warehouse(b,BUILDINGS.sawmill,5,'wood','roof');b.label('PINE & CO. SAWMILL',-44,4,-25.95,10,1);
 for(let row=0;row<3;row++)for(let i=0;i<5-row;i++){b.cyl('trunk',-50+i*.6+row*.3,.4+row*.52,-20,.29,5,Math.PI/2);b.cyl('wood',-50+i*.6+row*.3,.4+row*.52,-17.48,.24,.025,Math.PI/2);}
 for(let i=0;i<7;i++)b.box('wood',-35,.18+i*.17,-28,3,.14,6);b.box('darkSteel',-40,.72,-18,3,1.4,.85);b.label('TIMBER YARD',-38,2.5,-23,3,.65);
 const sawNpc=createCharacter();sawNpc.root.position.set(-40,0,-19);sawNpc.root.rotation.y=Math.PI;b.root.add(sawNpc.root);
 // Foundry: industrial shed, ventilation, ore bins and metal stock.
 b.box('concrete',40,.03,47,21,.15,17);warehouse(b,BUILDINGS.foundry,6,'rust','darkRoof');b.label('EASTBANK FOUNDRY',40,4.8,43.95,10,1,Math.PI);
 b.cyl('darkSteel',48,7,51,.75,14);b.cyl('rust',48,14,51,.95,.4);b.box('black',40,1.8,43.94,4,3.5,.05);b.box('orange',40,1.2,43.90,2.7,2.2,.02);
 for(let i=0;i<5;i++)b.box('steel',31+i*.3,.25,46,.2,.5,4);for(let i=0;i<8;i++)b.sphere('stone',48+rnd()*4,.3+rnd()*.5,42+rnd()*4,.5+rnd()*.5,.4,.6);
 b.box('darkSteel',37,.7,40,3.2,1.4,.8);const forgeNpc=createCharacter();forgeNpc.root.position.set(37,0,41);b.root.add(forgeNpc.root);
 // Drill on the north ridge. Triangulated derrick, drill string, pump and staging barrels.
 b.box('dirt',26,.01,-68,15,.15,13);const drillX=29,drillZ=-69;
 for(const sx of[-1,1])for(const sz of[-1,1])b.beam('yellow',new THREE.Vector3(drillX+sx*1.3,.1,drillZ+sz*1.3),new THREE.Vector3(drillX+sx*.4,9,drillZ+sz*.4),.14);
 for(let y=1;y<9;y+=1.5){const r=1.3-y*.1;for(const z of[-1,1]){b.box('darkSteel',drillX,y,drillZ+z*r,r*2,.12,.12);b.beam('yellow',new THREE.Vector3(drillX-r,y,drillZ+z*r),new THREE.Vector3(drillX+r-.15,y+1.5,drillZ+z*(r-.15)),.07);}}
 b.cyl('steel',drillX,4,drillZ,.12,8);b.box('darkSteel',drillX,.4,drillZ,3,.8,3);b.box('yellow',drillX+3,1,drillZ,2,2,2);b.box('darkSteel',drillX+3,2.2,drillZ,2.1,.3,2.1);for(let i=0;i<5;i++)barrel(b,21+i*.7,-71);b.label('NORTH RIDGE / SURVEY AREA',24,2.4,-61.8,5,.9);for(const x of[22,26])b.box('wood',x,1.2,-61.9,.12,2.4,.12);
 // Ore seam with angular exposed rocks, machinery, and marked quarry entrance.
 for(let i=0;i<24;i++){const x=71+rnd()*13,z=26+rnd()*18,r=.7+rnd()*2;const mesh=b.sphere(i%2?'stone':'stoneLight',x,r*.4,z,r,r*.8,r*.8);mesh.rotation.set(rnd(),rnd(),rnd());}
 b.box('yellow',73,.8,34,3,1.2,2);b.box('glass',73,1.8,34,1.5,1.1,1.4);b.beam('yellow',new THREE.Vector3(73,1.8,33),new THREE.Vector3(76,3,31),.35);b.beam('yellow',new THREE.Vector3(76,3,31),new THREE.Vector3(77,.4,29),.3);b.box('darkSteel',77,.3,29,1.5,.5,1);b.label('STONECUT QUARRY',67,2.3,31,4.5,.8);for(const x of[65,69])b.box('wood',x,1.2,30.9,.12,2.4,.12);
 // Private refinery plot: measured foundation and a sign at its entrance.
 b.box('dirt',-37,.015,44,17,.1,14);for(const x of[-44,-30])for(const z of[38,50]){b.box('wood',x,.7,z,.13,1.4,.13);b.box('cream',x,1.2,z,.18,.2,.18);}fence(b,-44,50,14);b.label('RIVERSIDE / BUILDING PLOT',-37,2,38.2,4.5,.8);b.box('wood',-39,1,38.1,.12,2,.12);b.box('wood',-35,1,38.1,.12,2,.12);
 // Town details make human-scale navigation legible.
 fence(b,12,15,18,Math.PI/2);fence(b,-15,20,18,Math.PI/2);fence(b,-55,-34,20);fence(b,38,-42,28);
 for(const [x,z]of[[6,18],[-6,-2],[21,-13],[-24,-17],[31,33],[43,-15]])lamp(b,x,z,Math.PI*.5);
 for(const footprint of[BUILDINGS.westHouse,BUILDINGS.eastHouse]){const {x}=footprint;warehouse(b,footprint,3.4,'wall','rust');b.box('glass',x,1.9,-2.46,2.6,1.1,.05);b.box('darkWood',x+1.8,1.3,-2.43,1.1,2.5,.05);}
 b.label('LOWLAND',-12,3.2,-2.4,4.8,.7);b.label('WORKSHOP',12,3.2,-2.4,4.8,.7);
 for(let i=0;i<6;i++){const x=-7,z=24-i*12;b.box('trunk',x,4.2,z,.17,8.4,.17);b.box('trunk',x,7.6,z,2.4,.12,.12);if(i<5)for(const dx of[-.85,.85])b.beam('darkSteel',new THREE.Vector3(x+dx,7.8,z),new THREE.Vector3(x+dx,7.8,z-12),.018);}
 function roadDistance(x:number,z:number){let min=999;for(const s of roadSegments){const dx=s.bx-s.ax,dz=s.bz-s.az,t=THREE.MathUtils.clamp(((x-s.ax)*dx+(z-s.az)*dz)/(dx*dx+dz*dz),0,1);min=Math.min(min,Math.hypot(x-s.ax-t*dx,z-s.az-t*dz)-s.width/2);}return min;}
 const trees=new Builder(),rocks=new Builder();
 const tree=(x:number,z:number,size:number,pine:boolean)=>{trees.cyl('trunk',x,size*.45,z,size*.055,size*.9);if(pine){for(let j=0;j<3;j++)trees.cone(j===1?'foliageLight':'foliageDark',x,size*(.52+j*.17),z,size*(.36-j*.065),size*.62);}else{for(let j=0;j<4;j++){const a=j*2.4;trees.sphere(j%2?'foliage':'foliageLight',x+Math.sin(a)*size*.18,size*(.72+j*.045),z+Math.cos(a)*size*.18,size*.3,size*.27,size*.3);}}};
 for(let i=0;i<380;i++){const x=(rnd()-.5)*250,z=(rnd()-.5)*240;if(roadDistance(x,z)<4||PLACES.some(p=>Math.hypot(x-p.position.x,z-p.position.z)<19)||Math.hypot(x,z)<25)continue;tree(x,z,4+rnd()*5,x<0||rnd()>.5);}
 for(let i=0;i<22;i++){const x=-65+(rnd()-.5)*18,z=-60+(rnd()-.5)*19;if(Math.hypot(x+62,z+55)>4)tree(x,z,5+rnd()*4,true);}
 const logs=new Builder();for(let i=0;i<4;i++)logs.cyl('trunk',-62+i*.7,.35,-58,.32,3.2,Math.PI/2);b.root.add(logs.root);b.label('PINEWOOD / FORESTRY',-61,2,-51,4,.8);for(const x of[-62.7,-59.3])b.box('wood',x,1,-51.1,.12,2,.12);
 for(let i=0;i<120;i++){const x=(rnd()-.5)*220,z=(rnd()-.5)*220;if(roadDistance(x,z)<4||PLACES.some(p=>Math.hypot(x-p.position.x,z-p.position.z)<14))continue;const r=.4+rnd()*1.4;rocks.sphere(i%2?'stone':'stoneLight',x,r*.3,z,r,r*.5,r*.7);}
 // Low-detail perimeter silhouettes and cultivated field rows.
 const grass=new Builder(),blade=new THREE.BufferGeometry();blade.setAttribute('position',new THREE.Float32BufferAttribute([-.045,0,0,.045,0,0,.025,.4,0],3));blade.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,.5,1],2));blade.computeVertexNormals();materials.foliageLight.side=THREE.DoubleSide;materials.foliage.side=THREE.DoubleSide;
 for(let i=0;i<2400;i++){const x=(rnd()-.5)*190,z=(rnd()-.5)*190;if(roadDistance(x,z)<1.2||PLACES.some(p=>Math.hypot(x-p.position.x,z-p.position.z)<13))continue;for(let j=0;j<3;j++)grass.mesh(blade,i%3?'foliageLight':'foliage',x,0,z,1,.5+rnd()*.9,1,0,rnd()*Math.PI,0);}
 for(let i=0;i<18;i++)b.box('dirt',-90+i*.8,-.01,25,.22,.03,30);
 const sceneGroup=new THREE.Group();sceneGroup.add(ground,b.batch(),trees.batch(),rocks.batch(),grass.batch());
 // A modest local buildable refinery is activated when player purchases the facility.
 const facilityBuilder=new Builder();tank(facilityBuilder,{x:-37,z:44,r:1.7},3.6);facilityBuilder.box('rust',-32,1,44,2,2,3);facilityBuilder.cyl('steel',-35,1,44,.1,5,0,0,Math.PI/2);const facility=facilityBuilder.batch();facility.visible=false;sceneGroup.add(facility);
 return {group:sceneGroup,colliders:WORLD_COLLIDERS,facility};
}

export function disposeAssets(){for(const m of Object.values(materials)){m.map?.dispose();m.dispose();}for(const k of Object.keys(materials))delete materials[k];}
