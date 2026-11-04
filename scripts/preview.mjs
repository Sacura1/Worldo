// Local QA serves the production build without Vite's optimizer or watcher.
// Production itself continues to require an explicitly configured HTTPS origin.
process.env.NODE_ENV = 'test';
process.env.APP_MODE = 'development';
process.env.PUBLIC_URL = 'http://localhost:3000';
process.env.APP_ORIGIN = 'http://localhost:3000';
process.env.ENABLE_MAINNET = 'false';
console.log('Starting isolated Worldo preview...');
const [{build},{default:path},{pathToFileURL},{mkdir},{default:express}]=await Promise.all([import('esbuild'),import('node:path'),import('node:url'),import('node:fs/promises'),import('express')]);
await mkdir(path.resolve('.local'),{recursive:true});
const bundle=path.resolve('.local/e2e-server.mjs');
await build({entryPoints:[path.resolve('scripts/e2e-server.ts')],outfile:bundle,bundle:true,platform:'node',packages:'external',format:'esm',target:'node24',logLevel:'warning'});
const {createApp,GameStore}=await import(pathToFileURL(bundle).href);
console.log('Preview modules loaded.');
const store=new GameStore(path.resolve('.local/e2e'),process.env.TEST_DATABASE_URL||'');
const app=await createApp(store,{frontend:false});
console.log('Preview API ready.');
app.use(express.static(path.resolve('dist')));
app.get('/{*splat}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
app.listen(3000,'127.0.0.1',()=>console.log('Worldo local QA is running at http://localhost:3000'));
