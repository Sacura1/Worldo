import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
await fs.mkdir('.local',{recursive:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});
await page.getByRole('button',{name:'Enter Worldo'}).waitFor({timeout:60000});
await page.screenshot({path:'.local/app-title.png'});
await page.getByRole('button',{name:'Enter Worldo'}).click();
await page.waitForTimeout(1000);
await page.screenshot({path:'.local/app-desktop.png'});
console.log(JSON.stringify({title:await page.title(),errors,body:(await page.locator('body').innerText()).slice(0,1500),world:await page.locator('.world-canvas').evaluate(el=>({...el.dataset}))},null,2));
await page.keyboard.down('w');await page.waitForTimeout(1500);await page.keyboard.up('w');await page.waitForTimeout(300);
await page.keyboard.press('e');await page.waitForTimeout(300);await page.screenshot({path:'.local/app-shop.png'});
console.log('Panel',await page.getByRole('dialog').count());
await page.close();
const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto('http://localhost:3000',{waitUntil:'domcontentloaded',timeout:60000});await mobile.getByRole('button',{name:'Enter Worldo'}).click();await mobile.waitForTimeout(1200);await mobile.screenshot({path:'.local/app-mobile.png'});
console.log(JSON.stringify({mobileOverflow:await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors}));
} finally { await browser.close(); }
