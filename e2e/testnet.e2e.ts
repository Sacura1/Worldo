import {test,expect,type Page,type Route} from '@playwright/test';
import type {GameState} from '../shared/types';
import {goTo,interactWith,readState} from './navigation';

async function testnetOnly(page:Page){
 const response=await page.request.get('/api/near/status');expect(response.ok()).toBe(true);
 const status=await response.json();
 // Fail closed before wallet activation or any signature. Never run this against mainnet.
 expect(status.network,'This integration test must never spend real NEAR').toBe('testnet');
 expect(status.testnetWalletEnabled).toBe(true);expect(status.intentsEnabled).toBe(false);
 expect(status.liveGameplayEnabled).toBe(true);expect(status.walletSetupEnabled).toBe(true);
 const rpcResponse=await page.request.get('/api/near/network-status');expect(rpcResponse.ok()).toBe(true);const rpc=await rpcResponse.json();expect(rpc.chainId).toBe('testnet');expect(rpc.network).toBe('testnet');expect(rpc.rpcUrl).toBe(status.rpcUrl);expect(Date.now()-rpc.verifiedAt).toBeLessThan(35000);
 expect(status.contractId).toMatch(/\.testnet$/);
 return status;
}
async function readAccount(page:Page){
 const response=await page.request.get('/api/near/account');expect(response.ok()).toBe(true);
 const result=await response.json();expect(result.network).toBe('testnet');expect(result.paused).toBe(false);
 return result.account as {balance:string;inventory:string[];refinery:boolean;harvest_nonce:number}|null;
}
async function confirmInBrowser(page:Page,method:string,amount:string){
 await testnetOnly(page);
 const review=page.getByRole('dialog',{name:'Review transaction',exact:true});
 await expect(review).toBeVisible();await expect(review).toContainText('NEAR testnet transaction');
 await expect(review.getByRole('button',{name:'Confirm and sign',exact:true})).toBeEnabled({timeout:45000});
 const prepared=page.waitForResponse(response=>response.url().endsWith('/api/near/prepare-action')&&response.request().method()==='POST');
 const relayed=page.waitForResponse(response=>response.url().endsWith('/api/near/relay')&&response.request().method()==='POST',{timeout:120000});
 await review.getByRole('button',{name:'Confirm and sign',exact:true}).click();
 const preparation=await prepared;expect(preparation.ok()).toBe(true);const action=await preparation.json();
 expect(action.network).toBe('testnet');expect(action.signingMode).toBe('testnet-wallet');expect(action.kind).toBe(['register','deposit'].includes(method)?'transaction':'delegateAction');expect(action.method).toBe(method);expect(action.deposit).toBe(amount);
 const confirmation=await relayed;expect(confirmation.ok()).toBe(true);const receipt=await confirmation.json();
 expect(receipt.explorerUrl).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\//);const sponsored=!['register','deposit'].includes(method);expect(receipt.gasSponsored).toBe(sponsored);expect(receipt.attachedDepositPayer).toBe(sponsored?'sponsor':'player');
 expect(receipt.outcome.status).toHaveProperty('SuccessValue');expect(receipt.outcome.receipts_outcome?.every((r:{outcome:{status:object}})=>!('Failure' in r.outcome.status))).not.toBe(false);
 console.log('WORLDO_TESTNET_RECEIPT:'+JSON.stringify({method,hash:receipt.hash,explorerUrl:receipt.explorerUrl}));
 await expect(review).not.toBeVisible({timeout:30000});
 return {...receipt,preparedArgs:action.args} as {hash:string;explorerUrl:string;preparedArgs:Record<string,unknown>;outcome:{status:{SuccessValue:string}}};
}


async function merchantAccount(page:Page,accountId:string){
 const status=await testnetOnly(page);
 const response=await page.request.post(status.rpcUrl,{data:{jsonrpc:'2.0',id:'worldo-qa-read-account',method:'query',params:{request_type:'call_function',finality:'final',account_id:status.contractId,method_name:'account',args_base64:Buffer.from(JSON.stringify({account_id:accountId})).toString('base64')}}});
 expect(response.ok()).toBe(true);const body=await response.json();expect(body.error).toBeUndefined();
 return JSON.parse(Buffer.from(body.result.result).toString()) as {balance:string;inventory:string[]};
}
async function assertCanonicalInventory(page:Page,expectedOre:number,expectedSteel:number,expectedBalance:string){
 const chain=await readAccount(page);expect(chain).not.toBeNull();expect(chain!.inventory[1]).toBe(String(expectedOre));expect(chain!.inventory[4]).toBe(String(expectedSteel));expect(chain!.balance).toBe(expectedBalance);
 const state=await readState(page,'live');expect(state.player.inventory.ore).toBe(expectedOre);expect(state.player.inventory.steel).toBe(expectedSteel);expect(state.live!.balanceYocto).toBe(expectedBalance);expect(state.live!.pendingOracle).toBe(false);
 return {chain:chain!,state};
}

test('testnet browser wallet and real quarry processing sale preserve canonical balances',async({page},testInfo)=>{
 test.skip(process.env.E2E_SCOPE!=='testnet'||testInfo.project.name!=='desktop','Explicit testnet scope and desktop project only; activation spends bounded test tokens.');
 test.setTimeout(600000);
 const errors:string[]=[],popups:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('popup',popup=>popups.push(popup.url()));
 await page.goto('/');await testnetOnly(page);
 await expect(page.getByRole('button',{name:'Enter Worldo',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();
 await page.locator('.balance-pill').click();
 await expect(page.getByRole('button',{name:'Create test wallet',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Create test wallet',exact:true}).click();
 const activation=page.getByRole('button',{name:'Activate wallet · setup sponsored',exact:true});await expect(activation).toBeEnabled({timeout:30000});
 const identityResponse=await page.request.get('/api/near/identity');const identity=(await identityResponse.json()).identity;expect(identity.authMethod).toBe('testnet-wallet');expect(identity.network).toBe('testnet');expect(identity.accountId).toMatch(/^[a-f0-9]{64}$/);
 await testnetOnly(page);await activation.click();
 await expect(page.getByRole('button',{name:'Review registration',exact:true})).toBeEnabled({timeout:120000});
 const balanceResponse=await page.request.get('/api/near/balance'),walletBefore=await balanceResponse.json();expect(balanceResponse.ok()).toBe(true);expect(walletBefore.network).toBe('testnet');expect(walletBefore.walletReady).toBe(true);expect(BigInt(walletBefore.amount)).toBe(10n**24n);
 expect(await readAccount(page)).toBeNull();
 // Native registration pays 0.01 test NEAR storage and credits the remaining 0.04.
 await page.getByLabel('AMOUNT IN NEAR',{exact:true}).fill('0.05');await page.getByRole('button',{name:'Review registration',exact:true}).click();
 const registration=await confirmInBrowser(page,'register','50000000000000000000000');
 await expect.poll(async()=>(await readAccount(page))?.balance,{timeout:45000}).toBe('40000000000000000000000');
 await expect(page.getByRole('button',{name:'Review game deposit',exact:true})).toBeEnabled();
 await page.getByLabel('AMOUNT IN NEAR',{exact:true}).fill('0.01');await page.getByRole('button',{name:'Review game deposit',exact:true}).click();
 const deposit=await confirmInBrowser(page,'deposit','10000000000000000000000');expect(deposit.hash).not.toBe(registration.hash);
 await expect.poll(async()=>(await readAccount(page))?.balance,{timeout:45000}).toBe('50000000000000000000000');
 const walletAfter=await(await page.request.get('/api/near/balance')).json();
 // The player pays both attached native deposits and their network fees.
 expect(BigInt(walletAfter.amount)).toBeLessThan(BigInt(walletBefore.amount)-60000000000000000000000n);
 // Hold real quote responses during the practice→chain render transition.
 const market=page.locator('.market-board'),marketValues=market.locator('.market-row strong');
 const practicePrices=await marketValues.allTextContents();expect(practicePrices).toHaveLength(3);expect(practicePrices.every(value=>/\d/.test(value))).toBe(true);
 let releaseQuotes!:()=>void;const quoteGate=new Promise<void>(resolve=>{releaseQuotes=resolve;});const realQuoteValues=new Map<string,number>();
 const quoteHandlers:Promise<void>[]=[];
 const holdRealQuotes=(route:Route)=>{
  const completed=(async()=>{const response=await route.fetch({timeout:45000});const quote=await response.json();if(response.ok()&&typeof quote.unitPrice==='number')realQuoteValues.set(route.request().postDataJSON().resource,quote.unitPrice);await quoteGate;await route.fulfill({response});})();
  quoteHandlers.push(completed);return completed;
 };
 await page.route('**/api/live/quote',holdRealQuotes);
 try{
  await page.getByRole('button',{name:'Enter testnet world',exact:true}).click();await expect(page.locator('.live-world-label')).toContainText('NEAR TESTNET');
  await expect.poll(()=>realQuoteValues.size,{timeout:45000,intervals:[250]}).toBe(3);
  await expect(market).toContainText('NEAR · change since arrival');await expect(marketValues).toHaveText(['—','—','—']);
  await page.screenshot({path:'test-results/testnet-real-quotes-pending.jpg',type:'jpeg',quality:80});
 }finally{
  releaseQuotes();
  // Preserve real handler failures and complete all fulfillments before unroute.
  let completedHandlers=0;while(completedHandlers<quoteHandlers.length){const batch=quoteHandlers.slice(completedHandlers);completedHandlers=quoteHandlers.length;await Promise.all(batch);}
  await page.unrouteAll({behavior:'wait'});
 }
 await expect(marketValues).toHaveText(['petrol','steel','planks'].map(resource=>realQuoteValues.get(resource)!.toLocaleString('en-US',{maximumFractionDigits:6})),{timeout:15000});
 console.log('Pending real chain quotes display dashes; releasing the unmodified responses populates actual NEAR prices.');
 const before=await readState(page,'live');
 expect(before.mode).toBe('live');expect(before.live?.accountId).toBe(identity.accountId);expect(before.live?.balanceYocto).toBe('50000000000000000000000');
 const account=await readAccount(page);expect(Object.values(before.player.inventory)).toHaveLength(6);
 const resources=['crude','ore','timber','petrol','steel','planks'] as const;expect(resources.map(resource=>String(before.player.inventory[resource]))).toEqual(account!.inventory);
 await page.screenshot({path:'test-results/testnet-live-confirmed.jpg',type:'jpeg',quality:80});
 // A reload opens practice by design. Re-entering reads the same signed-in chain account.
 await page.reload();await testnetOnly(page);await expect(page.getByRole('button',{name:'Enter Worldo',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Enter Worldo',exact:true}).click();await page.locator('.balance-pill').click();
 await expect(page.getByRole('button',{name:'Enter testnet world',exact:true})).toBeEnabled({timeout:45000});await page.getByRole('button',{name:'Enter testnet world',exact:true}).click();
 await expect(page.locator('.live-world-label')).toContainText('NEAR TESTNET');
 const after=await readState(page,'live');expect(after.live?.accountId).toBe(identity.accountId);expect(after.live?.balanceYocto).toBe(before.live?.balanceYocto);expect(after.player.inventory).toEqual(before.player.inventory);

 console.log('Testnet wallet registered, deposited and reloaded; starting physical quarry/foundry route.');
 // Actual authoritative gameplay: all movement and mutations go through controls.
 await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('combobox').selectOption('low');await page.getByRole('button',{name:'Close panel',exact:true}).click();
 await goTo(page,68,35,1.2,null,'live');await page.keyboard.press('e');await expect(page.getByRole('dialog',{name:'Stonecut Quarry',exact:true})).toBeVisible();
 const beforeHarvest=(await readAccount(page))!;expect(beforeHarvest.inventory[1]).toBe('0');await testnetOnly(page);
 const gathered=page.waitForResponse(r=>r.url().endsWith('/api/live/action')&&r.request().method()==='POST'&&r.request().postDataJSON()?.type==='gather',{timeout:120000});
 await page.getByRole('button',{name:'Mine iron ore',exact:true}).click();const harvestResponse=await gathered;expect(harvestResponse.ok()).toBe(true);const harvest=(await harvestResponse.json()).state as GameState;
 expect(harvest.player.inventory.ore).toBe(2);expect(harvest.live?.pendingOracle).toBe(false);expect(harvest.live?.receipt?.explorerUrl).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\//);
 console.log('WORLDO_TESTNET_RECEIPT:'+JSON.stringify({method:'grant_harvest',...harvest.live!.receipt}));
 const harvested=await assertCanonicalInventory(page,2,0,beforeHarvest.balance);expect(harvested.chain.harvest_nonce).toBe(beforeHarvest.harvest_nonce+1);expect(harvested.state.player.driving).toBe(false);
 await page.screenshot({path:'test-results/testnet-quarry-harvest.jpg',type:'jpeg',quality:80});await page.getByRole('button',{name:'Close panel',exact:true}).click();
 // The foundry faces north. Stand beside the outward door sweep, then enter.
 // Standing directly in its swing correctly rejects opening it onto the avatar.
 await goTo(page,41.8,42.7,.4,null,'live');if(!(await readState(page,'live')).doors?.['foundry-office-door']){const opened=page.waitForResponse(r=>r.url().endsWith('/api/live/action')&&r.request().method()==='POST'&&r.request().postDataJSON()?.type==='toggleDoor');await interactWith(page,'foundry-office-door');const doorResponse=await opened;expect(doorResponse.ok()).toBe(true);expect((await doorResponse.json()).state.doors?.['foundry-office-door']).toBe(true);}
 await goTo(page,39.4,47.3,.35,null,'live');await interactWith(page,'rosa');await expect(page.getByRole('dialog',{name:'Rosa',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Browse goods & services',exact:true}).click();await expect(page.getByRole('dialog',{name:'Eastbank Foundry',exact:true})).toBeVisible();await page.getByRole('button',{name:'Refine',exact:true}).click();
 const nativeBeforeSponsored=(await(await page.request.get('/api/near/balance')).json()).amount;
 const processPreview=page.waitForResponse(r=>r.url().endsWith('/api/live/action')&&r.request().method()==='POST'&&r.request().postDataJSON()?.type==='process');
 await page.getByRole('button',{name:/Review processing/}).click();const processPreviewResponse=await processPreview;expect(processPreviewResponse.ok()).toBe(true);const processAction=(await processPreviewResponse.json()).chainAction;expect(processAction.method).toBe('process');expect(processAction.args).toMatchObject({token_id:'ore',batches:1});expect(processAction.costYocto).toBe('1000000000000000000000');
 const merchantId=String(processAction.args.merchant_id),merchantBefore=await merchantAccount(page,merchantId);
 const processed=await confirmInBrowser(page,'process','1');expect(processed.preparedArgs).toMatchObject({merchant_id:merchantId,token_id:'ore',batches:1});
 const afterProcessingBalance=(BigInt(beforeHarvest.balance)-1000000000000000000000n).toString();await assertCanonicalInventory(page,0,1,afterProcessingBalance);
 const merchantProcessed=await merchantAccount(page,merchantId);expect(BigInt(merchantProcessed.balance)-BigInt(merchantBefore.balance)).toBe(1000000000000000000000n);expect(merchantProcessed.inventory).toEqual(merchantBefore.inventory);
 expect(BigInt(afterProcessingBalance)+BigInt(merchantProcessed.balance)).toBe(BigInt(beforeHarvest.balance)+BigInt(merchantBefore.balance));
 await page.getByRole('button',{name:'Sell cargo',exact:true}).click();await page.getByLabel('MATERIAL').selectOption('steel');
 await expect(page.getByRole('button',{name:'Review sale',exact:true})).toBeEnabled({timeout:45000});
 const salePreview=page.waitForResponse(r=>r.url().endsWith('/api/live/action')&&r.request().method()==='POST'&&r.request().postDataJSON()?.type==='trade');
 await page.getByRole('button',{name:'Review sale',exact:true}).click();const salePreviewResponse=await salePreview;expect(salePreviewResponse.ok()).toBe(true);const saleAction=(await salePreviewResponse.json()).chainAction;expect(saleAction.args).toMatchObject({merchant_id:merchantId,token_id:'steel',amount:'1',buy:false});
 const sold=await confirmInBrowser(page,'trade','1');expect(sold.preparedArgs).toEqual(saleAction.args);
 const soldAccount=(await readAccount(page))!;const earned=BigInt(soldAccount.balance)-BigInt(afterProcessingBalance);expect(earned).toBeGreaterThanOrEqual(BigInt(saleAction.receiveYocto));expect(earned).toBeGreaterThan(0n);
 const finalBalance=(BigInt(afterProcessingBalance)+earned).toString();await assertCanonicalInventory(page,0,0,finalBalance);
 const merchantSold=await merchantAccount(page,merchantId);expect(BigInt(merchantProcessed.balance)-BigInt(merchantSold.balance)).toBe(earned);expect(BigInt(merchantSold.inventory[4])-BigInt(merchantProcessed.inventory[4])).toBe(1n);
 expect(BigInt(finalBalance)+BigInt(merchantSold.balance)).toBe(BigInt(beforeHarvest.balance)+BigInt(merchantBefore.balance));
 expect((await(await page.request.get('/api/near/balance')).json()).amount).toBe(nativeBeforeSponsored);
 await page.screenshot({path:'test-results/testnet-foundry-sale.jpg',type:'jpeg',quality:80});
 expect(popups,'Local test-wallet signing must not open an Auth0 popup').toEqual([]);expect(errors).toEqual([]);
 console.log('Testnet browser flow confirmed: proof of wallet ownership, one-time activation, player-funded registration and deposit, finalized inventory, reload persistence, on-foot quarry harvest, foundry processing and steel sale with conserved player/merchant money.');
});
