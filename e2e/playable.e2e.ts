import {test,expect,type Page} from '@playwright/test';
import {goTo,interactWith,readState,startWorld,visitMorgan} from './navigation';
async function interact(page:Page,title:string){await page.keyboard.press('e');await expect(page.getByRole('dialog',{name:title,exact:true})).toBeVisible();}
async function recordScene(page:Page,name:string){
 await expect.poll(()=>page.locator('[data-camera-yaw]').evaluate(element=>Number((element as HTMLElement).dataset.triangles))).toBeGreaterThan(0);
 await page.waitForTimeout(500);
 const metrics=await page.locator('[data-camera-yaw]').evaluate(element=>{const d=(element as HTMLElement).dataset;return{triangles:Number(d.triangles),drawCalls:Number(d.drawCalls),fps:Number(d.fps),playerX:Number(d.playerX),playerZ:Number(d.playerZ)};});
 console.log(`Economy scene ${name}: ${JSON.stringify(metrics)}`);await page.screenshot({path:`test-results/economy-desktop-${name}.jpg`,type:'jpeg',quality:80});
}

test('walk, buy a scanner, survey, extract, process and sell through the game UI',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Full keyboard loop runs on desktop; portrait has a separate touch check.');
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await startWorld(page);
 console.log('Desktop: entered Worldo and selected battery-saver graphics.');
 await recordScene(page,'street');
 await visitMorgan(page);
 await page.getByRole('button',{name:/Resource scanner/}).click();
 await expect(page.getByRole('button',{name:/Scanner equipped/})).toBeDisabled();
 expect((await readState(page)).player.balance).toBe(108);
 console.log('Desktop: reached the depot and bought a scanner through the UI.');
 await page.getByRole('button',{name:'Close panel'}).click();
 await recordScene(page,'morgan-interior');
 // Leave through the open door; route planning respects the shared scenery.
 await goTo(page,0,11.4,.7);await goTo(page,25,-59,1.5);
 await interact(page,'North ridge');
 // Follow only the public scanner hints, never the server's hidden coordinate.
 const directions:Record<string,[number,number]>={north:[0,-1],northeast:[.707,-.707],east:[1,0],southeast:[.707,.707],south:[0,1],southwest:[-.707,.707],west:[-1,0],northwest:[-.707,-.707]};
 let lastSurveyAt=0;
 for(let scans=0;scans<10;scans++){
  if(Date.now()-lastSurveyAt<1850)await page.waitForTimeout(1850-(Date.now()-lastSurveyAt));
  const response=page.waitForResponse(r=>r.url().endsWith('/api/action')&&r.request().method()==='POST'&&r.request().postDataJSON()?.type==='survey');
  await page.getByRole('button',{name:/Survey this area/}).click();
  expect((await response).ok()).toBeTruthy();lastSurveyAt=Date.now();
  const survey=await readState(page);if(survey.player.discovered)break;
  expect(survey.player.depositPosition).toBeUndefined();
  const direction=survey.player.scanHint?.match(/Move (\w+)/)?.[1];expect(direction).toBeTruthy();
  const [dx,dz]=directions[direction!];await page.getByRole('button',{name:'Close panel'}).click();
  // A directional step can point into a visible rig. A nearby clear tile is
  // enough for the next reading; the hidden deposit itself remains unknown.
  await goTo(page,survey.player.position.x+dx*5,survey.player.position.z+dz*5,2.2);
  await interact(page,'North ridge');
 }
 await expect(page.getByRole('button',{name:'Extract crude oil'})).toBeEnabled();
 console.log('Desktop: located the hidden oil deposit using scanner hints.');
 await page.getByRole('button',{name:'Extract crude oil'}).click();
 await expect.poll(async()=>(await readState(page)).player.inventory.crude).toBe(2);
 await expect(page.getByRole('button',{name:/Equipment working/})).toBeDisabled();
 await page.getByRole('button',{name:'Close panel'}).click();
 await goTo(page,50,-24.5,.6);
 if(!(await readState(page)).doors?.['refinery-office-door']){await interactWith(page,'refinery-office-door');await expect.poll(async()=>(await readState(page)).doors?.['refinery-office-door']).toBe(true);}
 await goTo(page,50.3,-29.5,.4);await interactWith(page,'hale');await expect(page.getByRole('dialog',{name:'Hale',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Browse goods & services',exact:true}).click();await expect(page.getByRole('dialog',{name:'Lowland Refinery',exact:true})).toBeVisible();await page.getByRole('button',{name:'Refine',exact:true}).click();
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
 await startWorld(page);
 console.log('Portrait: entered Worldo; exercising touch navigation.');
 const session=await page.context().newCDPSession(page);await visitMorgan(page,session);
 await page.getByRole('button',{name:'Buy supplies',exact:true}).tap();
 await expect(page.getByRole('button',{name:'Confirm purchase'})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('button',{name:/Resource scanner/}).scrollIntoViewIfNeeded();await page.getByRole('button',{name:/Resource scanner/}).tap();
 await expect(page.getByRole('button',{name:/Scanner equipped/})).toBeDisabled();
 await page.screenshot({path:'test-results/portrait-depot.png'});
});
