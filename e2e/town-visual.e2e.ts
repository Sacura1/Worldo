import {test,expect,type Page,type CDPSession} from '@playwright/test';
import type {GameState} from '../shared/types';

async function readSession(page:Page):Promise<GameState>{
 return page.evaluate(async()=>{const response=await fetch('/api/session',{cache:'no-store'});if(!response.ok)throw new Error(`Session read failed: ${response.status}`);return response.json();});
}
async function moveUntil(page:Page,touch:CDPSession|null,forward:number,condition:(state:GameState)=>boolean){
 let finger:{x:number;y:number}|undefined;
 if(touch){const box=await page.getByRole('slider',{name:'Move character',exact:true}).boundingBox();expect(box).not.toBeNull();finger={x:box!.x+box!.width/2,y:box!.y+box!.height/2};await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...finger}]});await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:finger.x,y:finger.y-forward*30}]});}
 else await page.keyboard.down(forward>0?'w':'s');
 try{await expect.poll(async()=>condition(await readSession(page)),{timeout:60000,intervals:[300]}).toBe(true);}
 finally{if(touch)await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await page.keyboard.up(forward>0?'w':'s');}
 await page.waitForTimeout(700);
}
async function orbitPortrait(page:Page,touch:CDPSession|null){
 const size=page.viewportSize()!,before=await readSession(page),yaw=Number(await page.locator('.world-canvas').getAttribute('data-camera-yaw'));
 const desired=before.player.heading+Math.PI+.22,delta=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));
 if(touch){const start={x:size.width*.7,y:size.height*.47},dx=-delta/.004,steps=Math.max(1,Math.ceil(Math.abs(dx)/150));for(let part=0;part<steps;part++){await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:4,...start}]});for(let n=1;n<=12;n++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:4,x:start.x+dx/steps*n/12,y:start.y}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}}
 else{await page.mouse.move(size.width*.7,size.height*.48);await page.mouse.down();await page.mouse.move(size.width*.7-delta/.004,size.height*.48,{steps:20});await page.mouse.up();await page.mouse.wheel(0,-300);}
 await page.waitForTimeout(1000);
 const after=await readSession(page);expect(Math.abs(Math.atan2(Math.sin(after.player.heading-before.player.heading),Math.cos(after.player.heading-before.player.heading)))).toBeLessThan(.02);
}

test('living town visual walkthrough enters the supply shop and meets Morgan',async({page},testInfo)=>{
 test.setTimeout(240000);const portrait=testInfo.project.name==='portrait',errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await expect(page.getByRole('button',{name:'Enter Worldo',exact:true})).toBeEnabled();await page.waitForTimeout(1200);
 await page.screenshot({path:`test-results/town-${testInfo.project.name}-title.jpg`,type:'jpeg',quality:80});
 await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();await page.waitForTimeout(1200);
 const touch=portrait?await page.context().newCDPSession(page):null;
 await page.screenshot({path:`test-results/town-${testInfo.project.name}-street.jpg`,type:'jpeg',quality:80});
 await moveUntil(page,touch,1,state=>state.player.position.z<11.9);
 await expect(page.locator('.interact-prompt button')).toContainText(/Open.*supply/i);
 if(touch)await page.getByRole('button',{name:'Interact',exact:true}).tap();else await page.keyboard.press('e');
 await expect.poll(async()=>(await readSession(page)).doors?.['supply-door']).toBe(true);
 await moveUntil(page,touch,1,state=>state.player.position.z<5.5);
 const inside=await readSession(page);expect(inside.player.position.z).toBeGreaterThan(.5);expect(Math.abs(inside.player.position.x)).toBeLessThan(1);
 await page.screenshot({path:`test-results/town-${testInfo.project.name}-shop-interior.jpg`,type:'jpeg',quality:80});
 await expect(page.locator('.interact-prompt button')).toContainText('Talk to Morgan');
 if(touch)await page.getByRole('button',{name:'Interact',exact:true}).tap();else await page.keyboard.press('e');
 await expect(page.getByRole('dialog')).toContainText('Morgan');
 let settledPosition=(await readSession(page)).player.position,stableReads=0;
 await expect.poll(async()=>{const position=(await readSession(page)).player.position;stableReads=Math.hypot(position.x-settledPosition.x,position.z-settledPosition.z)<.01?stableReads+1:0;settledPosition=position;return stableReads;},{timeout:15000,intervals:[400]}).toBeGreaterThanOrEqual(3);
 const beforeConversation=await readSession(page);
 const provider=await page.evaluate(async()=>{const response=await fetch('/api/npc/status?npcId=morgan',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('NPC readiness is unavailable');return response.json() as Promise<{chat:{ready:boolean;reason:string};voice:{ready:boolean;reason:string}}>;});
 if(provider.chat.ready){
  // This case verifies text; do not spend an additional voice allowance for a visual tour.
  const turnVoiceOff=page.getByRole('button',{name:'Turn NPC voice off',exact:true});if(provider.voice.ready&&await turnVoiceOff.isVisible())await turnVoiceOff.click();
  await page.getByRole('textbox',{name:'Message Morgan'}).pressSequentially('What do you sell?',{delay:35});
  const responsePromise=page.waitForResponse(response=>response.url().endsWith('/api/npc/chat')&&response.request().method()==='POST',{timeout:45000});
  await page.getByRole('button',{name:'Send message',exact:true}).click();const response=await responsePromise;expect(response.ok()).toBe(true);
  const reply=await response.json();expect(reply.source).toBe('near-ai');expect(typeof reply.text).toBe('string');expect(reply.text.length).toBeGreaterThan(10);expect(reply.text.length).toBeLessThanOrEqual(1200);expect(reply.replyId).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.locator('.dialogue-line.assistant').last()).toContainText(reply.text);
  console.log(`Town dialogue ${testInfo.project.name}: actual configured NEAR AI reply received.`);
 }else{
  await expect(page.getByRole('textbox',{name:'Message Morgan'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
  await expect(page.locator('.dialogue-availability').first()).toContainText(provider.chat.reason);
  await expect(page.locator('.dialogue-voice')).toContainText('AI unavailable');
  console.log(`Town dialogue ${testInfo.project.name}: provider unavailable shown honestly; no AI generation claimed.`);
 }
 await page.screenshot({path:`test-results/town-${testInfo.project.name}-conversation.jpg`,type:'jpeg',quality:80});
 const browse=page.getByRole('button',{name:'Browse goods & services',exact:true});await expect(browse).toBeEnabled();await browse.click();
 await expect(page.getByRole('dialog')).toContainText(/Supply depot/i);
 const afterConversation=await readSession(page);expect(afterConversation.player.balance).toBe(beforeConversation.player.balance);expect(afterConversation.player.inventory).toEqual(beforeConversation.player.inventory);
 expect(Math.hypot(afterConversation.player.position.x-beforeConversation.player.position.x,afterConversation.player.position.z-beforeConversation.player.position.z)).toBeLessThan(.05);
 expect(afterConversation.merchants).toEqual(beforeConversation.merchants);
 await page.getByRole('button',{name:'Close panel',exact:true}).click();
 await moveUntil(page,touch,-1,state=>state.player.position.z>13.2);
 await orbitPortrait(page,touch);
 await page.screenshot({path:`test-results/town-${testInfo.project.name}-character.jpg`,type:'jpeg',quality:80});
 expect(errors).toEqual([]);
 const renderer=await page.locator('.world-canvas').evaluate(element=>({fps:(element as HTMLElement).dataset.fps,drawCalls:(element as HTMLElement).dataset.drawCalls,triangles:(element as HTMLElement).dataset.triangles}));
 console.log(`Headless software-renderer sample ${testInfo.project.name}: ${JSON.stringify(renderer)}`);
 console.log(`Living town ${testInfo.project.name}: real controls opened the shop door, entered the furnished room, met Morgan, and returned to the street.`);
});
