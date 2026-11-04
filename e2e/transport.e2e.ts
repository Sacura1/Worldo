import {test,expect,type Page} from '@playwright/test';
import {goTo,readState as state,startWorld} from './navigation';

const separation=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const angleDifference=(a:number,b:number)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
async function waitForStop(page:Page){
 let previous=(await state(page)).player.position,stable=0;
 await expect.poll(async()=>{await page.waitForTimeout(400);const current=(await state(page)).player.position;stable=separation(current,previous)<.12?stable+1:0;previous=current;return stable;},{timeout:15000,intervals:[250]}).toBeGreaterThanOrEqual(3);
 return state(page);
}

test('pickup transport uses real controls and retains parking and fuel after reload',async({page},testInfo)=>{
 test.setTimeout(120000);
 const portrait=testInfo.project.name==='portrait',errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await startWorld(page);
 const touch=portrait?await page.context().newCDPSession(page):null;
 const start=await state(page),originalTruck=start.truckPosition!;
 expect(start.player.driving).toBe(false);expect(separation(start.player.position,originalTruck)).toBeGreaterThan(6);
 // Approach through the ordinary camera-relative walking controls. The public
 // scene planner keeps the avatar outside scenery and the parked truck body.
 await goTo(page,originalTruck.x,originalTruck.z,5.2,touch);
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
