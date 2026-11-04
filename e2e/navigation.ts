import {expect,type CDPSession,type Page} from '@playwright/test';
import type {GameState,Vec2} from '../shared/types';
import {getWorldColliders,SERVICE_NPCS,TOWN_DOORS} from '../shared/town';
import {bodyCollides,motionIsClear,parkedVehicleCollider} from '../shared/world-physics';

export const distance=(a:Vec2,b:Vec2)=>Math.hypot(a.x-b.x,a.z-b.z);
export async function readState(page:Page,mode:'demo'|'live'='demo'):Promise<GameState>{
 const response=await page.evaluate(async mode=>{const r=await fetch(mode==='live'?'/api/live/session':'/api/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(mode==='live'?30000:10000)});return{ok:r.ok,status:r.status,body:await r.json()};},mode);
 expect(response.ok,`Session returned HTTP ${response.status}`).toBeTruthy();return response.body;
}
export async function startWorld(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();
 await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('combobox').selectOption('low');await page.getByRole('button',{name:'Close panel'}).click();
 await expect(page.locator('[data-camera-yaw]')).toHaveAttribute('data-camera-yaw',/.+/);
}
type Node=Vec2&{key:string;g:number;f:number;parent?:Node};
/** Plans against public scene geometry only; every move still uses game controls. */
export function walkingPath(from:Vec2,target:Vec2,state:GameState,tolerance:number):Vec2[]{
 const solid=[...getWorldColliders(Object.keys(state.doors??{}).filter(id=>state.doors![id])),parkedVehicleCollider(state.truckPosition??{x:8,z:24},state.truckHeading??0)];
 const padded=solid.map(c=>({...c,w:c.w+.36,d:c.d+.36}));
 const targetBlocked=bodyCollides(target,0,false,solid);
 const colliders=bodyCollides(from,0,false,padded)||bodyCollides(target,0,false,padded)?solid:padded;
 const clear=(a:Vec2,b:Vec2)=>motionIsClear(a,b,0,0,false,colliders);
 const nearbyTargets:Vec2[]=[];
 if(targetBlocked)for(let radius=.25;radius<tolerance;radius+=.25)for(let direction=0;direction<24;direction++){
  const angle=direction*Math.PI/12,candidate={x:target.x+Math.cos(angle)*radius,z:target.z+Math.sin(angle)*radius};
  if(!bodyCollides(candidate,0,false,colliders))nearbyTargets.push(candidate);
 }
 if(distance(from,target)<=tolerance)return[];
 if(clear(from,target))return[target];
 const heap:Node[]=[],cost=new Map<string,number>();
 const push=(node:Node)=>{heap.push(node);let i=heap.length-1;while(i){const p=(i-1)>>1;if(heap[p].f<=node.f)break;heap[i]=heap[p];i=p;}heap[i]=node;};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1].f<heap[child].f)child++;if(heap[child].f>=last.f)break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
 const start:Node={...from,key:'start',g:0,f:distance(from,target)};push(start);cost.set(start.key,0);let goal:Node|undefined;
 for(let iterations=0;heap.length&&iterations<45000;iterations++){
  const current=pop();if(current.g!==cost.get(current.key))continue;
  if(targetBlocked&&distance(current,target)<tolerance+1.8){
   const reachable=nearbyTargets.find(candidate=>clear(current,candidate));
   if(reachable){goal={...reachable,key:'goal',g:current.g+distance(current,reachable),f:0,parent:current};break;}
  }
  // A scanner direction may point into a visible rig. Stop at a reachable tile
  // within the requested tolerance, keeping enough room for control settling.
  const arrivalRadius=Math.max(.25,tolerance-(targetBlocked ? .25 : .8));
  if(distance(current,target)<=arrivalRadius){goal=current;break;}
  if(distance(current,target)<1.8&&clear(current,target)){goal={...target,key:'goal',g:current.g+distance(current,target),f:0,parent:current};break;}
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
   if(!dx&&!dz)continue;const next={x:Math.round(current.x)+dx,z:Math.round(current.z)+dz};if(Math.abs(next.x)>98||Math.abs(next.z)>98||!clear(current,next))continue;
   const key=`${next.x},${next.z}`,g=current.g+distance(current,next);if(g>=(cost.get(key)??Infinity))continue;cost.set(key,g);push({...next,key,g,f:g+distance(next,target),parent:current});
  }
 }
 if(!goal)throw new Error(`No walking route to ${target.x},${target.z}; check whether its door is open.`);
 const route:Vec2[]=[];for(let node:Node|undefined=goal;node?.parent;node=node.parent)route.unshift({x:node.x,z:node.z});
 const smooth:Vec2[]=[];let current=from,index=0;
 while(index<route.length){let last=index;for(let look=route.length-1;look>index;look--)if(clear(current,route[look])){last=look;break;}smooth.push(route[last]);current=route[last];index=last+1;}
 return smooth;
}

/** Camera-relative keyboard or native touch; never teleports or writes API state. */
export async function goTo(page:Page,x:number,z:number,tolerance=1,touch:CDPSession|null=null,mode:'demo'|'live'='demo'){
 const game=await readState(page,mode),target={x,z},path=walkingPath(game.player.position,target,game,tolerance),deadline=Date.now()+180000;
 if(!path.length)return;
 const held=new Set<string>();let centre:Vec2|undefined;
 if(touch){const box=await page.getByRole('slider',{name:'Move character'}).boundingBox();expect(box).not.toBeNull();centre={x:box!.x+box!.width/2,z:box!.y+box!.height/2};await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:centre.x,y:centre.z}]});}
 try{
  for(let index=0;index<path.length;index++){
   const waypoint=path[index],last=index===path.length-1,threshold=last?Math.min(tolerance*.65,.65,Math.max(.15,tolerance-distance(waypoint,target)-.15)):.45;
   let bestDistance=Infinity,lastProgressAt=Date.now();
   while(true){
    const pose=await page.locator('[data-camera-yaw]').evaluate(element=>{const d=(element as HTMLElement).dataset;return{x:Number(d.playerX),z:Number(d.playerZ),yaw:Number(d.cameraYaw)};});
    if(distance(pose,waypoint)<=threshold||(last&&distance(pose,target)<tolerance*.8))break;
    const remaining=distance(pose,waypoint);if(remaining<bestDistance-.15){bestDistance=remaining;lastProgressAt=Date.now();}
    if(Date.now()-lastProgressAt>15000)throw new Error(`Walking stalled for 15 seconds at ${pose.x.toFixed(2)},${pose.z.toFixed(2)}; waypoint ${waypoint.x},${waypoint.z}`);
    if(Date.now()>deadline)throw new Error(`Walking did not reach ${x},${z}; actual ${pose.x.toFixed(2)},${pose.z.toFixed(2)}; waypoint ${waypoint.x},${waypoint.z}`);
    const dx=waypoint.x-pose.x,dz=waypoint.z-pose.z,length=Math.hypot(dx,dz),side=(dx*Math.cos(pose.yaw)-dz*Math.sin(pose.yaw))/length,forward=(-dx*Math.sin(pose.yaw)-dz*Math.cos(pose.yaw))/length;
    if(touch){await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:centre!.x+side*30,y:centre!.z-forward*30}]});}
    else{
     const wanted=new Set<string>();if(forward>.25)wanted.add('w');if(forward<-.25)wanted.add('s');if(side>.25)wanted.add('d');if(side<-.25)wanted.add('a');
     if(remaining>4)wanted.add('Shift');
     for(const key of held)if(!wanted.has(key)){await page.keyboard.up(key);held.delete(key);}for(const key of wanted)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}
    }
    await page.waitForTimeout(100);
   }
  }
 }finally{
  if(touch)await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  for(const key of held)await page.keyboard.up(key);
 }
 await expect.poll(async()=>distance((await readState(page,mode)).player.position,target),{timeout:mode==='live'?45000:10000,intervals:[mode==='live'?1000:250]}).toBeLessThan(tolerance+0.4);
}

export async function interactWith(page:Page,id:string,touch:CDPSession|null=null){
 await expect(page.locator('[data-camera-yaw]')).toHaveAttribute('data-interaction-id',id,{timeout:10000});
 if(!touch){const prompt=page.locator('.interact-prompt button');await expect(prompt).toBeVisible();const npc=SERVICE_NPCS.find(npc=>npc.id===id),door=TOWN_DOORS.find(door=>door.id===id);if(npc)await expect(prompt).toContainText(`Talk to ${npc.name}`);else if(door)await expect(prompt).toContainText(door.label);}
 if(touch)await page.getByRole('button',{name:'Interact',exact:true}).tap();else await page.keyboard.press('e');
}

export async function visitMorgan(page:Page,touch:CDPSession|null=null){
 await goTo(page,0,11.4,.65,touch);
 if(!(await readState(page)).doors?.['supply-door']){await interactWith(page,'supply-door',touch);await expect.poll(async()=>(await readState(page)).doors?.['supply-door']).toBe(true);}
 await goTo(page,0,5.4,.5,touch);await interactWith(page,'morgan',touch);await expect(page.getByRole('dialog',{name:'Morgan',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Browse goods & services',exact:true}).click();await expect(page.getByRole('dialog',{name:'Supply depot',exact:true})).toBeVisible();
}
