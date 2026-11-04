import {test,expect,type Page} from '@playwright/test';
import type {GameState} from '../shared/types';

async function readState(page:Page):Promise<GameState>{const response=await page.request.get('/api/session');expect(response.ok()).toBeTruthy();return response.json();}
async function start(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();await expect(page.getByRole('button',{name:'Open settings'})).toBeVisible();
 // Functional browser tests use the shipped battery-saver mode. GPU performance
 // on actual desktop/mobile hardware is measured separately from this scenario.
 await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('combobox').selectOption('low');await page.getByRole('button',{name:'Close panel'}).click();
}
async function inputPulse(page:Page,keys:string[],duration:number){
 // Release inputs in the renderer's own event loop. A heavily scheduled test
 // runner must not accidentally leave a steering key held for several seconds.
 await page.evaluate(async({keys,duration})=>{
  const event=(key:string,type:string)=>document.body.dispatchEvent(new KeyboardEvent(type,{key,code:key==='Shift'?'ShiftLeft':`Key${key.toUpperCase()}`,bubbles:true}));
  keys.forEach(key=>event(key,'keydown'));
  try{await new Promise(resolve=>setTimeout(resolve,duration));}finally{keys.forEach(key=>event(key,'keyup'));}
 },{keys,duration});
}
async function goTo(page:Page,x:number,z:number,tolerance=2){
 const deadline=Date.now()+90000;
 try{while(Date.now()<deadline){
  const state=await readState(page),p=state.player,dx=x-p.position.x,dz=z-p.position.z;
  const remaining=Math.hypot(dx,dz);
  if(remaining<=tolerance){await page.waitForTimeout(300);return;}
  const desired=Math.atan2(-dx,-dz),error=Math.atan2(Math.sin(desired-p.heading),Math.cos(desired-p.heading));
  if(Math.abs(error)>.12)await inputPulse(page,[error<0?'d':'a'],Math.min(500,Math.max(45,Math.abs(error)/2.3*1000)));
  else await inputPulse(page,['Shift','w'],Math.min(1200,Math.max(100,(remaining-tolerance)/6*1000)));
 }
 throw new Error(`Did not reach ${x}, ${z}; actual ${JSON.stringify((await readState(page)).player.position)}`);
 }finally{await page.keyboard.up('w');await page.keyboard.up('a');await page.keyboard.up('d');await page.keyboard.up('Shift');}
}
async function interact(page:Page,title:string){await page.keyboard.press('e');await expect(page.getByRole('dialog',{name:title,exact:true})).toBeVisible();}

test('walk, buy a scanner, survey, extract, process and sell through the game UI',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Full keyboard loop runs on desktop; portrait has a separate touch check.');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await start(page);
 console.log('Desktop: entered Worldo and selected battery-saver graphics.');
 await goTo(page,0,19,1.5);await interact(page,'Supply depot');
 await page.getByRole('button',{name:/Resource scanner/}).click();
 await expect(page.getByRole('button',{name:/Scanner equipped/})).toBeDisabled();
 expect((await readState(page)).player.balance).toBe(108);
 console.log('Desktop: reached the depot and bought a scanner through the UI.');
 await page.getByRole('button',{name:'Close panel'}).click();
 // Pass east of the depot building, then follow open ground to North ridge.
 await goTo(page,8,19);await goTo(page,8,-22);await goTo(page,25,-59);
 await interact(page,'North ridge');
 // Follow only the public scanner hints, never the server's hidden coordinate.
 const directions:Record<string,[number,number]>={north:[0,-1],northeast:[.707,-.707],east:[1,0],southeast:[.707,.707],south:[0,1],southwest:[-.707,.707],west:[-1,0],northwest:[-.707,-.707]};
 for(let scans=0;scans<10;scans++){
  const response=page.waitForResponse(r=>r.url().endsWith('/api/action')&&r.request().method()==='POST'&&r.request().postDataJSON()?.type==='survey');
  await page.getByRole('button',{name:/Survey this area/}).click();
  expect((await response).ok()).toBeTruthy();
  const survey=await readState(page);if(survey.player.discovered)break;
  expect(survey.player.depositPosition).toBeUndefined();
  const direction=survey.player.scanHint?.match(/Move (\w+)/)?.[1];expect(direction).toBeTruthy();
  const [dx,dz]=directions[direction!];await page.getByRole('button',{name:'Close panel'}).click();
  await goTo(page,survey.player.position.x+dx*5,survey.player.position.z+dz*5,1);
  await interact(page,'North ridge');
 }
 await expect(page.getByRole('button',{name:'Extract crude oil'})).toBeEnabled();
 console.log('Desktop: located the hidden oil deposit using scanner hints.');
 await page.getByRole('button',{name:'Extract crude oil'}).click();
 await expect.poll(async()=>(await readState(page)).player.inventory.crude).toBe(2);
 await expect(page.getByRole('button',{name:/Equipment working/})).toBeDisabled();
 await page.getByRole('button',{name:'Close panel'}).click();
 await goTo(page,35,-48);await goTo(page,36,-27);await goTo(page,40,-14);
 await interact(page,'Lowland Refinery');await page.getByRole('button',{name:'Refine',exact:true}).click();
 await expect(page.getByText('Service fee per batch')).toBeVisible();
 await page.getByRole('button',{name:'Process batch · 2 CR',exact:true}).click();
 await expect.poll(async()=>(await readState(page)).player.inventory.petrol).toBe(1);
 await page.getByRole('button',{name:'Sell cargo',exact:true}).click();await page.getByLabel('MATERIAL').selectOption('petrol');
 const before=(await readState(page)).player.balance;
 await page.getByRole('button',{name:'Confirm sale'}).click();
 await expect.poll(async()=>(await readState(page)).player.inventory.petrol).toBe(0);
 expect((await readState(page)).player.balance).toBeGreaterThan(before);
 console.log('Desktop: extracted, refined and sold the resulting petrol.');
 await page.reload();await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();
 expect((await readState(page)).player.scanner).toBe(true);
 expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/desktop-completed-loop.png'});
});

test('portrait touch movement opens a usable depot panel without horizontal overflow',async({page},info)=>{
 test.skip(info.project.name!=='portrait','Touch layout runs in the portrait project.');
 await start(page);
 console.log('Portrait: entered Worldo; exercising touch navigation.');
 const joystick=page.getByRole('slider',{name:'Move character'});await expect(joystick).toBeVisible();const box=await joystick.boundingBox();expect(box).not.toBeNull();
 const session=await page.context().newCDPSession(page),x=box!.x+box!.width/2,y=box!.y+box!.height/2;
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-30}]});
 await page.waitForTimeout(1700);
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.getByRole('button',{name:'Interact',exact:true}).tap();
 await expect(page.getByRole('dialog',{name:'Supply depot',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Buy supplies',exact:true}).tap();
 await expect(page.getByRole('button',{name:'Confirm purchase'})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:/Resource scanner/}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:/Resource scanner/}).tap();
 await expect(page.getByRole('button',{name:/Scanner equipped/})).toBeDisabled();
 await page.screenshot({path:'test-results/portrait-depot.png'});
});
