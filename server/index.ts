import express,{type Request,type Response,type NextFunction} from 'express';
import helmet from 'helmet';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {actionSchema} from './action-schema';
import {applyAction,newGame,GameError} from './economy';
import {GameStore} from './store';
import {createNearRouter} from './near';
import {canonicalAppOrigin} from './near-config';
import {createIntentsRouter} from './intents';
import {createLiveRouter} from './live';

declare global {namespace Express {interface Request {sessionId?:string;}}}
export {actionSchema} from './action-schema';
const cookieName='lowland_session';
const sessionHash=(token:string)=>createHash('sha256').update(token).digest('hex');

export async function createApp(store=new GameStore(),options:{frontend?:boolean}={}) {
 const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
 const production=process.env.NODE_ENV==='production';
 const appOrigin=canonicalAppOrigin();
 app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
 app.use(express.json({limit:'16kb'}));
 app.use('/api',(req:Request,res:Response,next:NextFunction)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
   const origin=req.get('origin');
   const allowed=appOrigin;
   if(origin&&origin!==allowed&&!( !production&&['http://localhost:5173','http://127.0.0.1:5173','http://localhost:3000','http://127.0.0.1:3000'].includes(origin)))return res.status(403).json({error:'This request came from a different site.'});
   if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed.'});
  }
  next();
 });
 const hits=new Map<string,{since:number,count:number}>();
 app.use('/api',(req,res,next)=>{const now=Date.now(),ip=req.ip??'unknown';let hit=hits.get(ip);if(!hit||now-hit.since>60000){hit={since:now,count:0};hits.set(ip,hit);}if(++hit.count>900)return res.status(429).json({error:'Too many requests. Wait a moment and try again.'});if(hits.size>10000)for(const[key,value]of hits)if(now-value.since>60000)hits.delete(key);next();});
 app.get('/api/health',async(_req,res)=>{try{await store.ping();res.json({status:'ok',game:'worldo',economy:'practice',storage:store.persistent?'neon':'local'});}catch{res.status(503).json({status:'unavailable',error:'Game storage is unavailable.'});}});
 app.use('/api',async(req,res,next)=>{
  try{
   const cookie=req.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
   let token=cookie&&/^[a-f0-9]{64}$/.test(cookie)?cookie:undefined;
   if(!token){token=randomBytes(32).toString('hex');res.cookie(cookieName,token,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:30*86400000});req.sessionId=sessionHash(token);await store.create(req.sessionId);}
   else req.sessionId=sessionHash(token);
   next();
  }catch(error){next(error);}
 });
 app.get('/api/session',async(req,res,next)=>{try{const saved=await store.get(req.sessionId!)??await store.create(req.sessionId!);res.json(saved.state);}catch(error){next(error);}});
 app.post('/api/action',async(req,res,next)=>{
  try{
   const parsed=actionSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid game action.'});
   const requestId=req.get('x-request-id');if(requestId&&!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))return res.status(400).json({error:'Invalid request identifier.'});
   const now=Date.now();const result=await store.mutate(req.sessionId!,old=>{
    if(requestId&&old.meta.requests.some(r=>r.id===requestId))return old;
    const next=applyAction(old,parsed.data,now);
    if(requestId){next.meta.requests=next.meta.requests.filter(r=>now-r.at<3600000).slice(-255);next.meta.requests.push({id:requestId,at:now});}return next;
   });res.json(result.state);
  }catch(error){next(error);}
 });
 app.post('/api/reset',async(req,res,next)=>{try{const result=await store.mutate(req.sessionId!,old=>{const fresh=newGame(old.state.player.id);fresh.state.revision=old.state.revision+1;return fresh;});res.json(result.state);}catch(error){next(error);}});
 app.use('/api/near',createNearRouter());
 app.use('/api/intents',createIntentsRouter());
 app.use('/api/live',createLiveRouter(store));
 app.use('/api',(_req,res)=>res.status(404).json({error:'Endpoint not found.'}));
 if(options.frontend!==false){
  if(production){app.use(express.static(path.resolve('dist'),{maxAge:'1h',index:false}));app.get('/{*splat}',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));}
  else{const {createServer}=await import('vite');const vite=await createServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
 }
 app.use((error:unknown,req:Request,res:Response,_next:NextFunction)=>{
  if(error instanceof GameError)return res.status(error.status).json({error:error.message});
  if(error instanceof SyntaxError)return res.status(400).json({error:'Invalid JSON request.'});
  console.error('Request failed',req.path,error instanceof Error?error.message:'Unknown error');
  res.status(500).json({error:'The request could not be completed. Please try again.'});
 });return app;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const port=Number(process.env.PORT??3000);const app=await createApp();app.listen(port,'0.0.0.0',()=>console.log(`Worldo is running at http://localhost:${port}`));
}
