import {test,expect,type Page,type CDPSession} from '@playwright/test';
import type {GameState} from '../shared/types';

const separation=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const angleDifference=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
async function state(page:Page):Promise<GameState>{
 // Use the application's browser connection and cookies. A separate Node-side
 // request context can stall on local DNS even while the public game works.
 const response=await page.evaluate(async()=>{
  const result=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
  return{ok:result.ok,status:result.status,body:await result.json()};
 });
 expect(response.ok,`Read-only session request returned HTTP ${response.status}`).toBeTruthy();return response.body;
}
async function joystickPulse(page:Page,session:CDPSession,dx:number,dy:number,duration:number){
 const box=await page.getByRole('slider',{name:/Move character|Steer and drive/}).boundingBox();expect(box).not.toBeNull();
 const x=box!.x+box!.width/2,y=box!.y+box!.height/2;
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 try{await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});await page.waitForTimeout(duration);}
 finally{await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
}
async function waitForStop(page:Page){
 let previous=(await state(page)).player.position,stable=0;
 await expect.poll(async()=>{await page.waitForTimeout(400);const current=(await state(page)).player.position;stable=separation(current,previous)<.12?stable+1:0;previous=current;return stable;},{timeout:15000,intervals:[250]}).toBeGreaterThanOrEqual(3);
 return state(page);
}

test('pickup transport uses real controls and retains parking and fuel after reload',async({page},testInfo)=>{
 test.setTimeout(120000);
 const portrait=testInfo.project.name==='portrait',errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();
 await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('combobox').selectOption('low');await page.getByRole('button',{name:'Close panel'}).click();
 const touch=portrait?await page.context().newCDPSession(page):null;
 const start=await state(page),originalTruck=start.truckPosition!;
 expect(start.player.driving).toBe(false);expect(separation(start.player.position,originalTruck)).toBeGreaterThan(6);
 // Face and approach the visible pickup. Feedback makes the input sequence
 // independent of the software renderer's exact frame rate.
 const approachHistory:{heading:number;distance:number}[]=[];
 if(!touch){
  const desired=Math.atan2(start.player.position.x-originalTruck.x,start.player.position.z-originalTruck.z),error=Math.atan2(Math.sin(desired-start.player.heading),Math.cos(desired-start.player.heading));
  const turnKey=error<0?'d':'a';await page.keyboard.down(turnKey);
  try{await expect.poll(async()=>angleDifference((await state(page)).player.heading,desired),{timeout:30000,intervals:[200]}).toBeLessThan(.3);}
  finally{await page.keyboard.up(turnKey);}
  await page.waitForTimeout(300);await page.keyboard.down('w');
  try{await expect.poll(async()=>separation((await state(page)).player.position,originalTruck),{timeout:30000,intervals:[200]}).toBeLessThan(5.4);}
  finally{await page.keyboard.up('w');}
  await page.waitForTimeout(300);
 }else for(let step=0;step<20;step++){
  const player=(await state(page)).player;approachHistory.push({heading:player.heading,distance:separation(player.position,originalTruck)});if(separation(player.position,originalTruck)<5.4)break;
  const desired=Math.atan2(player.position.x-originalTruck.x,player.position.z-originalTruck.z),error=Math.atan2(Math.sin(desired-player.heading),Math.cos(desired-player.heading));
  if(Math.abs(error)>.2){const duration=Math.min(450,Math.max(70,Math.abs(error)/2.3*1000));await joystickPulse(page,touch,error<0?30:-30,0,duration);}
  else await joystickPulse(page,touch,0,-30,600);
 }
 if(approachHistory.length&&approachHistory.at(-1)!.distance>=5.4)console.log(`Transport ${testInfo.project.name} approach: ${JSON.stringify(approachHistory)}`);
 await expect.poll(async()=>separation((await state(page)).player.position,originalTruck),{timeout:15000}).toBeLessThan(6);
 if(portrait)await page.getByRole('button',{name:'Enter pickup',exact:true}).tap();else await page.keyboard.press('f');
 await expect.poll(async()=>(await state(page)).player.driving).toBe(true);
 const boarded=await state(page),fuelBefore=boarded.player.fuel;
 console.log(`Transport ${testInfo.project.name}: boarded the pickup using ${portrait?'touch':'keyboard'} controls.`);
 if(touch){
  const accelerator=await page.getByRole('button',{name:'Accelerate',exact:true}).boundingBox(),joystick=await page.getByRole('slider',{name:'Steer and drive',exact:true}).boundingBox();
  expect(accelerator).not.toBeNull();expect(joystick).not.toBeNull();
  const throttle={id:1,x:accelerator!.x+accelerator!.width/2,y:accelerator!.y+accelerator!.height/2};
  const stick={id:2,x:joystick!.x+joystick!.width/2,y:joystick!.y+joystick!.height/2};
  // Observe delivered pointer events without changing game state. A protocol
  // mismatch must fail here rather than look like a game-control regression.
  await page.evaluate(()=>{
   for(const label of ['Accelerate','Steer and drive']){
    const element=document.querySelector(`[aria-label="${label}"]`) as HTMLElement&{qaPointers?:{active:Set<number>;ups:number;cancels:number}};
    const activity={active:new Set<number>(),ups:0,cancels:0};element.qaPointers=activity;
    element.addEventListener('pointerdown',event=>activity.active.add(event.pointerId));
    element.addEventListener('pointerup',event=>{activity.active.delete(event.pointerId);activity.ups++;});
    element.addEventListener('pointercancel',event=>{activity.active.delete(event.pointerId);activity.cancels++;});
   }
  });
  const pointerActivity=(label:string)=>page.locator(`[aria-label="${label}"]`).evaluate(element=>{const activity=(element as HTMLElement&{qaPointers:{active:Set<number>;ups:number;cancels:number}}).qaPointers;return{active:activity.active.size,ups:activity.ups,cancels:activity.cancels};});
  expect(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('[aria-label="Accelerate"]'),throttle),'The accelerator must remain touchable while notifications are visible.').toBe(true);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[throttle]});
  try{
   expect(await pointerActivity('Accelerate')).toEqual({active:1,ups:0,cancels:0});
   await expect.poll(async()=>separation((await state(page)).player.position,boarded.player.position),{timeout:8000,intervals:[250]}).toBeGreaterThan(8);
   const straight=await state(page);
   // Keep the accelerator finger down while a second finger steers. These are
   // native browser touch events, so pointer capture and multi-touch both run.
   await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[throttle,stick]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[throttle,{...stick,x:stick.x+28}]});
   expect(await pointerActivity('Steer and drive')).toEqual({active:1,ups:0,cancels:0});
   await expect.poll(async()=>{const turned=await state(page);return angleDifference(turned.player.heading,straight.player.heading)>.3&&separation(turned.player.position,straight.player.position)>3;},{timeout:8000,intervals:[250]}).toBe(true);
   // Chromium's default WebTouchEvent path releases the supplied IDs on
   // touchEnd; empty touchPoints would release every finger. The test config
   // disables SyntheticPointerActions, whose alternate semantics differ.
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{...stick,x:stick.x+28}]});
   expect(await pointerActivity('Steer and drive')).toEqual({active:0,ups:1,cancels:0});
   expect(await pointerActivity('Accelerate')).toEqual({active:1,ups:0,cancels:0});
   await page.waitForTimeout(300);const releasedStick=await state(page);
   await expect.poll(async()=>separation((await state(page)).player.position,releasedStick.player.position),{timeout:8000,intervals:[250]}).toBeGreaterThan(4);
   const continuing=await state(page);
   expect(angleDifference(continuing.player.heading,releasedStick.player.heading)).toBeLessThan(.16);
  }finally{await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  expect(await pointerActivity('Accelerate')).toEqual({active:0,ups:1,cancels:0});
 }else{
  await page.keyboard.down('w');
  try{await expect.poll(async()=>separation((await state(page)).player.position,boarded.player.position),{timeout:8000,intervals:[250]}).toBeGreaterThan(8);}
  finally{await page.keyboard.up('w');}
  const straight=await state(page);await page.keyboard.down('w');await page.keyboard.down('d');
  try{await expect.poll(async()=>{const turned=await state(page);return angleDifference(turned.player.heading,straight.player.heading)>.3&&separation(turned.player.position,straight.player.position)>3;},{timeout:8000,intervals:[250]}).toBe(true);}
  finally{await page.keyboard.up('w');await page.keyboard.up('d');}
 }
 const stopped=await waitForStop(page);
 expect(separation(stopped.player.position,originalTruck)).toBeGreaterThan(10);
 expect(stopped.player.fuel).toBeLessThan(fuelBefore-.3);expect(stopped.player.fuel).toBeGreaterThan(0);
 await page.screenshot({path:`test-results/transport-${testInfo.project.name}-driving.png`});
 if(portrait)await page.getByRole('button',{name:'Exit pickup',exact:true}).tap();else await page.keyboard.press('f');
 await expect.poll(async()=>(await state(page)).player.driving).toBe(false);
 const parked=await state(page);expect(separation(parked.truckPosition!,stopped.player.position)).toBeLessThan(.3);
 expect(parked.truckHeading).toBeDefined();expect(angleDifference(parked.truckHeading!,stopped.player.heading)).toBeLessThan(.01);
 expect(separation(parked.player.position,parked.truckPosition!)).toBeLessThan(3);
 await page.reload();await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();
 const resumed=await state(page);expect(resumed.player.driving).toBe(false);expect(resumed.truckPosition).toEqual(parked.truckPosition);expect(resumed.truckHeading).toEqual(parked.truckHeading);expect(resumed.player.fuel).toBeCloseTo(parked.player.fuel,6);
 // Boarding again proves that the persisted vehicle is usable at its new location.
 if(portrait)await page.getByRole('button',{name:'Enter pickup',exact:true}).tap();else await page.keyboard.press('f');
 await expect.poll(async()=>(await state(page)).player.driving).toBe(true);
 const reboarded=await state(page);expect(separation(reboarded.player.position,parked.truckPosition!)).toBeLessThan(.1);expect(angleDifference(reboarded.player.heading,parked.truckHeading!)).toBeLessThan(.01);
 expect(errors).toEqual([]);
 console.log(`Transport ${testInfo.project.name}: drove, steered, stopped, exited and re-boarded after reload; fuel use persisted.`);
});
