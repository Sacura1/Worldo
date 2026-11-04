import {BUILDINGS,TANKS,ROADS,type Collider,type Footprint} from './world-layout';
import type {PlaceId,Vec2} from './types';

export interface TownBuilding extends Footprint {id:string;name:string;kind:'store'|'refinery'|'sawmill'|'foundry'|'house';height:number;front:'north'|'south';doorWidth:number;wall:string;roof:string;}
export const TOWN_BUILDINGS:readonly TownBuilding[]=[
 {...BUILDINGS.depot,id:'supply',name:'LOWLAND SUPPLY',kind:'store',height:3.8,front:'south',doorWidth:2.2,wall:'cream',roof:'darkRoof'},
 {...BUILDINGS.refinery,id:'refinery-office',name:'LOWLAND REFINERY',kind:'refinery',height:4,front:'south',doorWidth:2.2,wall:'brick',roof:'roof'},
 {...BUILDINGS.sawmill,id:'sawmill-office',name:'PINE & CO.',kind:'sawmill',height:3.8,front:'south',doorWidth:2.2,wall:'wood',roof:'darkRoof'},
 {...BUILDINGS.foundry,id:'foundry-office',name:'EASTBANK FOUNDRY',kind:'foundry',height:4.5,front:'north',doorWidth:2.2,wall:'brick',roof:'darkRoof'},
 {...BUILDINGS.westHouse,id:'cedar-house',name:'CEDAR HOUSE',kind:'house',height:3,front:'south',doorWidth:1.65,wall:'wall',roof:'rust'},
 {...BUILDINGS.eastHouse,id:'olive-house',name:'OLIVE HOUSE',kind:'house',height:3,front:'south',doorWidth:1.65,wall:'sage',roof:'darkRoof'},
 {x:-25,z:4,w:7,d:7,id:'willow-house',name:'WILLOW HOUSE',kind:'house',height:3.1,front:'south',doorWidth:1.65,wall:'cream',roof:'roof'},
 {x:24,z:-8,w:7,d:8,id:'ochre-house',name:'OCHRE HOUSE',kind:'house',height:3.2,front:'south',doorWidth:1.65,wall:'ochre',roof:'rust'},
];
export interface TownDoor {id:string;buildingId:string;position:Vec2;hinge:Vec2;width:number;rotation:number;closedCollider:Collider;label:string;}
export const TOWN_DOORS:readonly TownDoor[]=TOWN_BUILDINGS.map(b=>{
 const z=b.z+(b.front==='south'?1:-1)*b.d/2;
 return{id:`${b.id}-door`,buildingId:b.id,position:{x:b.x,z},hinge:{x:b.x-b.doorWidth/2,z},width:b.doorWidth,rotation:0,closedCollider:{x:b.x,z,w:b.doorWidth,d:.18,height:2.65},label:b.kind==='house'?b.name.toLowerCase():'the '+b.name.toLowerCase()};
});
export interface TownInterior extends Footprint {id:string;name:string;kind:TownBuilding['kind'];ceiling:number;}
export const TOWN_INTERIORS:readonly TownInterior[]=TOWN_BUILDINGS.map(b=>({id:b.id,name:b.name,kind:b.kind,x:b.x,z:b.z,w:b.w-.45,d:b.d-.45,ceiling:b.height}));
export interface ServiceNpc {id:string;name:string;role:string;place:PlaceId;position:Vec2;heading:number;shirt:string;skin:string;hair:string;}
export const NPC_INTERACTION_RADIUS=3.2;
export const SERVICE_NPCS:readonly ServiceNpc[]=[
 {id:'morgan',name:'Morgan',role:'Supply shopkeeper',place:'depot',position:{x:-2,z:3.2},heading:Math.PI,shirt:'shirtBlue',skin:'skin',hair:'hairBrown'},
 {id:'hale',name:'Hale',role:'Refinery operator',place:'refinery',position:{x:48,z:-28.5},heading:Math.PI,shirt:'workOrange',skin:'skinDark',hair:'hairDark'},
 {id:'imani',name:'Imani',role:'Sawmill owner',place:'sawmill',position:{x:-41,z:-26.5},heading:Math.PI,shirt:'shirtRed',skin:'skinDark',hair:'hairDark'},
 {id:'rosa',name:'Rosa',role:'Foundry manager',place:'foundry',position:{x:37,z:46.5},heading:0,shirt:'workOrange',skin:'skinLight',hair:'hairBrown'},
 {id:'station-attendant',name:'Theo',role:'Filling station attendant',place:'depot',position:{x:5.7,z:15.5},heading:-Math.PI/2,shirt:'shirtBlue',skin:'skin',hair:'hairDark'},
];
export const FUEL_PUMPS=[
 {id:'pump-one',place:'depot' as const,position:{x:8,z:12.5},label:'Petrol pump 01'},
 {id:'pump-two',place:'depot' as const,position:{x:8,z:18},label:'Petrol pump 02'},
] as const;
export interface TownResident {id:string;name:string;role:string;route:readonly Vec2[];speed:number;pause:number;shirt:string;skin:string;hair:string;carrying?:'box'|'timber'|'tool';work?:'hammer'|'pump'|'sweep';}
export const TOWN_RESIDENTS:readonly TownResident[]=[
 {id:'nora',name:'Nora',role:'Neighbour',route:[{x:-12,z:1},{x:-18,z:5},{x:-17,z:13},{x:-9,z:16},{x:-7,z:9}],speed:.9,pause:3,shirt:'shirtRed',skin:'skinLight',hair:'hairBrown'},
 {id:'ellis',name:'Ellis',role:'Courier',route:[{x:4,z:27},{x:16,z:27},{x:25,z:28},{x:32,z:38},{x:28,z:30},{x:16,z:27}],speed:1.1,pause:2,shirt:'shirtBlue',skin:'skinDark',hair:'hairDark',carrying:'box'},
 {id:'sana',name:'Sana',role:'Timber worker',route:[{x:-31.5,z:-26},{x:-31.5,z:-32},{x:-30,z:-32},{x:-30,z:-26}],speed:.65,pause:4,shirt:'workOrange',skin:'skin',hair:'hairDark',carrying:'timber'},
 {id:'jo',name:'Jo',role:'Refinery mechanic',route:[{x:53,z:-20},{x:56,z:-21},{x:56,z:-29},{x:55.4,z:-30},{x:55.4,z:-21}],speed:.7,pause:5,shirt:'workOrange',skin:'skinLight',hair:'hairBrown',carrying:'tool',work:'pump'},
 {id:'leon',name:'Leon',role:'Foundry worker',route:[{x:46.8,z:40},{x:50,z:39},{x:50,z:45},{x:47,z:42}],speed:.75,pause:5,shirt:'shirtBlue',skin:'skinDark',hair:'hairDark',work:'hammer'},
 {id:'ada',name:'Ada',role:'Gardener',route:[{x:18,z:1},{x:24,z:1},{x:28,z:4},{x:22,z:5}],speed:.65,pause:6,shirt:'sage',skin:'skin',hair:'hairBrown',work:'sweep'},
];

export interface TownTree {id:string;x:number;z:number;height:number;radius:number;type:'pine'|'oak';}
export interface TownRock {id:string;x:number;z:number;w:number;d:number;height:number;rotation:number;}
export interface TownFence {id:string;x:number;z:number;length:number;axis:'x'|'z';}
export const TOWN_FENCES:readonly TownFence[]=[
 {id:'yard-west',x:-18,z:-11,length:12,axis:'x'},{id:'yard-west-side',x:-18,z:-11,length:9,axis:'z'},
 {id:'yard-east',x:8,z:-11,length:10,axis:'x'},{id:'yard-east-side',x:18,z:-11,length:10,axis:'z'},
 {id:'timber-back',x:-56,z:-36,length:25,axis:'x'},{id:'refinery-back',x:37,z:-44,length:29,axis:'x'},
 {id:'plot-back',x:-44,z:50,length:14,axis:'x'},
];
function generator(seed:number){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
function distanceToRoad(x:number,z:number){return Math.min(...ROADS.map(([ax,az,bx,bz,w])=>{const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));return Math.hypot(x-ax-t*dx,z-az-t*dz)-w/2;}));}
const random=generator(57231);
const protectedAreas:Footprint[]=[...TOWN_BUILDINGS,{x:53,z:-29,w:35,d:32},{x:-43,z:-28,w:28,d:24},{x:40,z:48,w:28,d:24},{x:9,z:16,w:13,d:18},{x:26,z:-68,w:24,d:24},{x:71,z:35,w:27,d:24},{x:-37,z:43,w:24,d:20},{x:0,z:20,w:24,d:20}];
const trees:TownTree[]=[];
for(let i=0;i<130;i++){const x=Math.round((random()-.5)*186),z=Math.round((random()-.5)*186);if(distanceToRoad(x,z)<5||protectedAreas.some(p=>Math.abs(x-p.x)<p.w/2+4&&Math.abs(z-p.z)<p.d/2+4))continue;trees.push({id:`tree-${i}`,x,z,height:4.5+random()*4,radius:.19+random()*.12,type:random()>.55?'pine':'oak'});}
export const TOWN_TREES:readonly TownTree[]=trees;
const rocks:TownRock[]=[];
for(let i=0;i<22;i++){const x=72+random()*11,z=25+random()*20;rocks.push({id:`quarry-rock-${i}`,x,z,w:.9+random()*2,d:.9+random()*2,height:.6+random()*1.3,rotation:random()*Math.PI});}
export const TOWN_ROCKS:readonly TownRock[]=rocks;
export const TOWN_PROPS:readonly (Footprint&{id:string;kind:'barrel'|'crate'|'bench'|'planter'|'machine'|'timber';height:number})[]=[
 {id:'depot-crate',kind:'crate',x:-5,z:11,w:1.1,d:1.1,height:1.1},{id:'depot-bench',kind:'bench',x:3.5,z:10.8,w:2.2,d:.65,height:.9},
 {id:'front-planter',kind:'planter',x:-5.1,z:9.8,w:1,d:.9,height:.7},{id:'station-planter',kind:'planter',x:13.3,z:22.2,w:1.2,d:1.2,height:.7},
 {id:'oil-barrel-1',kind:'barrel',x:21,z:-71,w:.7,d:.7,height:1},{id:'oil-barrel-2',kind:'barrel',x:22,z:-71,w:.7,d:.7,height:1},
 {id:'oil-barrel-3',kind:'barrel',x:23,z:-71,w:.7,d:.7,height:1},{id:'refinery-barrel',kind:'barrel',x:56,z:-35,w:.7,d:.7,height:1},
 {id:'timber-stack',kind:'timber',x:-52,z:-25,w:2.8,d:5,height:1.7},{id:'saw-machine',kind:'machine',x:-34,z:-30,w:2,d:3.5,height:1.4},
 {id:'foundry-machine',kind:'machine',x:48,z:49,w:2,d:3,height:1.6},{id:'foundry-crate',kind:'crate',x:31,z:44,w:1.4,d:1.4,height:1.2},
 {id:'refinery-pump-base',kind:'machine',x:56,z:-34,w:1.6,d:1.3,height:1.9},
];
export const TOWN_LAMPS:readonly Vec2[]=[{x:4.5,z:22},{x:-7,z:2},{x:20,z:-14},{x:-24,z:-17},{x:31,z:33},{x:43,z:-15}];
export const FURNITURE_COLLIDERS:readonly Collider[]=[
 {x:-2,z:4.2,w:4.3,d:.75},{x:-5,z:4.3,w:.75,d:5},{x:5,z:4.3,w:.75,d:5},{x:0,z:1,w:5.7,d:.65},
 {x:48,z:-27.6,w:3.4,d:.75},{x:52.8,z:-31.5,w:1.2,d:3},
 {x:-41,z:-25.5,w:3.2,d:.75},{x:-47.5,z:-30,w:2,d:3.5},
 {x:37,z:45.5,w:3.2,d:.75},{x:43,z:50,w:3.5,d:1.2},
 ...TOWN_BUILDINGS.filter(b=>b.kind==='house').flatMap(b=>[{x:b.x-b.w/2+1.2,z:b.z-1.2,w:1.5,d:2.5},{x:b.x+1.6,z:b.z-1.6,w:1.7,d:1.1},{x:b.x+1.5,z:b.z+1.7,w:1.2,d:.7}]),
 ...FUEL_PUMPS.map(p=>({x:p.position.x,z:p.position.z,w:1.1,d:.7,height:1.8})),
 ...[5.8,13.5].flatMap(x=>[10,21].map(z=>({x,z,w:.25,d:.25,height:4}))),
];
function buildingWalls(b:TownBuilding):Collider[]{
 const wall=.24,frontZ=b.z+(b.front==='south'?1:-1)*b.d/2,backZ=b.z-(b.front==='south'?1:-1)*b.d/2,side=(b.w-b.doorWidth)/2;
 return[{x:b.x-b.w/2,z:b.z,w:wall,d:b.d,height:b.height},{x:b.x+b.w/2,z:b.z,w:wall,d:b.d,height:b.height},{x:b.x,z:backZ,w:b.w,d:wall,height:b.height},{x:b.x-b.doorWidth/2-side/2,z:frontZ,w:side,d:wall,height:b.height},{x:b.x+b.doorWidth/2+side/2,z:frontZ,w:side,d:wall,height:b.height}];
}
export const TOWN_STATIC_COLLIDERS:readonly Collider[]=[
 ...TOWN_BUILDINGS.flatMap(buildingWalls),...Object.values(TANKS).map(t=>({x:t.x,z:t.z,w:t.r*2+.25,d:t.r*2+.25,height:7})),...FURNITURE_COLLIDERS.map(c=>({height:1.2,...c})),
 ...TOWN_TREES.map(t=>({x:t.x,z:t.z,w:t.radius*2,d:t.radius*2,height:t.height})),
 ...TOWN_ROCKS.map(r=>({x:r.x,z:r.z,w:Math.abs(Math.cos(r.rotation))*r.w+Math.abs(Math.sin(r.rotation))*r.d,d:Math.abs(Math.sin(r.rotation))*r.w+Math.abs(Math.cos(r.rotation))*r.d,height:r.height})),
 ...TOWN_FENCES.map(f=>({x:f.x+(f.axis==='x'?f.length/2:0),z:f.z+(f.axis==='z'?f.length/2:0),w:f.axis==='x'?f.length:.16,d:f.axis==='z'?f.length:.16,height:1.5})),
 ...TOWN_PROPS.map(prop=>({...prop,kind:'prop' as const})),...TOWN_LAMPS.map(p=>({...p,w:.22,d:.22,height:5.5})),
 ...TOWN_BUILDINGS.filter(b=>b.kind==='house').flatMap(b=>[-1,1].map(side=>({x:b.x+side*b.w*.34,z:b.z+(b.front==='south'?1:-1)*(b.d/2+1.5),w:.13,d:.13,height:2.6}))),
 ...[47,53].map(x=>({x,z:-39,w:1.26,d:1.26,height:14.2})),
 ...[49,63].flatMap(x=>[-34,-24].map(z=>({x,z,w:.18,d:.18,height:4}))),
 {x:48,z:51,w:1.1,d:1.1,height:11.8},
 ...SERVICE_NPCS.map(n=>({x:n.position.x,z:n.position.z,w:.6,d:.6,height:1.8,kind:'npc' as const,id:n.id})),
 {x:29,z:-69,w:3,d:3},{x:32,z:-69,w:2.2,d:2.2},{x:73,z:34,w:3,d:2},
];
export function getWorldColliders(openDoorIds:ReadonlySet<string>|readonly string[]=[]):readonly Collider[]{
 const open=openDoorIds instanceof Set?openDoorIds:new Set(openDoorIds);
 return[...TOWN_STATIC_COLLIDERS,...TOWN_DOORS.map(d=>open.has(d.id)?{x:d.hinge.x,z:d.hinge.z-d.width/2,w:.18,d:d.width,height:2.65}:d.closedCollider)];
}
export function getTownInterior(position:Vec2):TownInterior|null{return TOWN_INTERIORS.find(b=>Math.abs(position.x-b.x)<b.w/2&&Math.abs(position.z-b.z)<b.d/2)??null;}
