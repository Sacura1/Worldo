import {defineConfig} from '@playwright/test';
const baseURL=process.env.E2E_BASE_URL||process.env.BASE_URL;
export default defineConfig({
 testDir:'./e2e',testMatch:process.env.E2E_SCOPE==='transport'?'**/transport.e2e.ts':process.env.E2E_SCOPE==='town'?'**/town-visual.e2e.ts':process.env.E2E_SCOPE==='testnet'?'**/testnet.e2e.ts':process.env.E2E_SCOPE==='economy'?'**/playable.e2e.ts':'**/*.e2e.ts',timeout:360000,expect:{timeout:15000},fullyParallel:false,workers:1,
 reporter:[['list']],use:{actionTimeout:30000,baseURL:baseURL||'http://localhost:3000',channel:process.platform==='win32'&&!process.env.CI?'msedge':undefined,headless:true,screenshot:'only-on-failure',trace:'retain-on-failure',launchOptions:{args:['--disable-features=SyntheticPointerActions','--enable-webgl','--ignore-gpu-blocklist',...(process.env.CI?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]}},
 webServer:baseURL?undefined:{command:'node scripts/preview.mjs',url:'http://localhost:3000/api/health',reuseExistingServer:!process.env.CI,timeout:120000},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:900}}},...(process.env.E2E_SCOPE==='economy'?[]:[{name:'portrait',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}}])]
});
