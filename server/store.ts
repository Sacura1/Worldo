import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {migrateNavigation,newGame,type SavedGame} from './economy';

const locks=new Map<string,Promise<unknown>>();
export async function serialized<T>(id:string,operation:()=>Promise<T>):Promise<T>{
 const previous=locks.get(id)??Promise.resolve();
 const current=previous.catch(()=>{}).then(operation);locks.set(id,current);
 try{return await current;}finally{if(locks.get(id)===current)locks.delete(id);}
}
export class GameStore {
 private sql:NeonQueryFunction<false,false>|null;
 private ready:Promise<void>;
 readonly persistent:boolean;
 constructor(private directory=process.env.LOCAL_DATA_DIR??path.resolve('.local/games'),databaseUrl=process.env.DATABASE_URL){
  this.sql=databaseUrl?neon(databaseUrl):null;this.persistent=!!this.sql;
  this.ready=this.initialize();
 }
 private async initialize(){
  if(this.sql)await this.sql`CREATE TABLE IF NOT EXISTS lowland_sessions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  else await mkdir(this.directory,{recursive:true});
 }
 private file(id:string){if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid session identifier');return path.join(this.directory,`${id}.json`);}
 async ping(){await this.ready;if(this.sql)await this.sql`SELECT 1`;}
 private async readRaw(id:string):Promise<SavedGame|null>{
  await this.ready;
  if(this.sql){const rows=await this.sql`SELECT data FROM lowland_sessions WHERE id=${id}`;return rows[0]?.data as SavedGame??null;}
  try{return JSON.parse(await readFile(this.file(id),'utf8')) as SavedGame;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 }
 async get(id:string):Promise<SavedGame|null>{
  for(let attempt=0;attempt<8;attempt++){
   const saved=await this.readRaw(id);if(!saved)return null;const migrated=migrateNavigation(saved);if(migrated===saved)return saved;
   if(await this.compareAndSwap(id,saved.state.revision,migrated))return migrated;
  }
  throw new Error('Your world is being updated. Please try again.');
 }
 async create(id:string):Promise<SavedGame>{
  await this.ready;const fresh=newGame();
  if(this.sql){await this.sql`INSERT INTO lowland_sessions(id,revision,data) VALUES(${id},${fresh.state.revision},${JSON.stringify(fresh)}::jsonb) ON CONFLICT(id) DO NOTHING`;return (await this.get(id))!;}
  return serialized(id,async()=>{const existing=await this.readRaw(id);if(existing){const migrated=migrateNavigation(existing);if(migrated!==existing)await this.writeLocal(id,migrated);return migrated;}await this.writeLocal(id,fresh);return fresh;});
 }
 private async writeLocal(id:string,data:SavedGame){const file=this.file(id),temporary=`${file}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(data),{mode:0o600});await rename(temporary,file);}
 async compareAndSwap(id:string,revision:number,data:SavedGame):Promise<boolean>{
  await this.ready;
  if(this.sql){const rows=await this.sql`UPDATE lowland_sessions SET data=${JSON.stringify(data)}::jsonb, revision=${data.state.revision}, updated_at=now() WHERE id=${id} AND revision=${revision} RETURNING id`;return rows.length===1;}
  return serialized(id,async()=>{const old=await this.readRaw(id);if(!old||old.state.revision!==revision)return false;await this.writeLocal(id,data);return true;});
 }
 async mutate(id:string,change:(saved:SavedGame)=>SavedGame):Promise<SavedGame>{
  // PostgreSQL CAS remains correct when several Fly machines handle the same session.
  for(let attempt=0;attempt<8;attempt++){const old=await this.get(id);if(!old)throw new Error('Session expired');const next=change(old);if(next===old)return old;if(await this.compareAndSwap(id,old.state.revision,next))return next;}
  throw new Error('Your session is busy. Please try again.');
 }
}
