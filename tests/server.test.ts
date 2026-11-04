import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index';
import {GameStore} from '../server/store';

describe('HTTP session and action boundary',()=>{
 let server:Server,base:string,folder:string,cookie:string;
 beforeAll(async()=>{folder=await mkdtemp(path.join(os.tmpdir(),'lowland-api-'));server=createServer(await createApp(new GameStore(folder,''),{frontend:false}));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;},20000);
 afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));if(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep))await rm(folder,{recursive:true,force:true});});
 it('creates an opaque HttpOnly session and serves an honest mode',async()=>{const res=await fetch(`${base}/api/session`);expect(res.status).toBe(200);const set=res.headers.get('set-cookie')!;expect(set).toContain('HttpOnly');expect(set).toContain('SameSite=Strict');cookie=set.split(';')[0];const body=await res.json();expect(body.mode).toBe('demo');expect(cookie).not.toContain(body.player.id);expect(body.meta).toBeUndefined();});
 it('rejects cross-site mutation',async()=>{const res=await fetch(`${base}/api/action`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:'https://attacker.example'},body:JSON.stringify({type:'advance'})});expect(res.status).toBe(403);});
 it('validates actions and rejects balance injection',async()=>{const res=await fetch(`${base}/api/action`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({type:'advance',balance:100000})});expect(res.status).toBe(400);});
 it('does not repeat a mutation with the same idempotency key',async()=>{const headers={cookie,'content-type':'application/json','x-request-id':'advance-request-01'};const a=await fetch(`${base}/api/action`,{method:'POST',headers,body:JSON.stringify({type:'advance'})});expect(a.status).toBe(200);const first=await a.json();const b=await fetch(`${base}/api/action`,{method:'POST',headers,body:JSON.stringify({type:'advance'})});expect(b.status).toBe(200);const second=await b.json();expect(second.day).toBe(first.day);expect(second.revision).toBe(first.revision);});
 it('isolates new guest sessions',async()=>{const res=await fetch(`${base}/api/session`);const fresh=await res.json();expect(fresh.day).toBe(1);const original=await (await fetch(`${base}/api/session`,{headers:{cookie}})).json();expect(original.day).toBe(2);});
 it('exposes health and actual storage without secrets',async()=>{const res=await fetch(`${base}/api/health`);expect(await res.json()).toEqual({status:'ok',game:'worldo',economy:'practice',storage:'local'});});
});
