import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {neon,type NeonQueryFunction} from '@neondatabase/serverless';
import {serialized} from './store';
import {GameError} from './economy';

export type NpcProvider='near-ai'|'elevenlabs';
type DailyUsage={day:string;'near-ai':number;elevenlabs:number};

/** Reserve before contacting a paid provider. Failed/uncertain calls still count. */
export class NpcBudget {
 private sql:NeonQueryFunction<false,false>|null;
 private ready?:Promise<void>;
 constructor(private directory=process.env.LOCAL_DATA_DIR??path.resolve('.local/games'),databaseUrl=process.env.DATABASE_URL){this.sql=databaseUrl?neon(databaseUrl):null;}
 private initialize(){
  return this.ready??=this.sql?(async()=>{
   await this.sql!`CREATE TABLE IF NOT EXISTS worldo_npc_usage (day DATE NOT NULL,provider TEXT NOT NULL,amount BIGINT NOT NULL CHECK(amount>=0),PRIMARY KEY(day,provider))`;
   await this.sql!`DELETE FROM worldo_npc_usage WHERE day < CURRENT_DATE - INTERVAL '30 days'`;
  })():mkdir(this.directory,{recursive:true}).then(()=>{});
 }
 async reserve(provider:NpcProvider,amount:number,limit:number,now=Date.now()):Promise<void>{
  if(!Number.isSafeInteger(amount)||amount<1||!Number.isSafeInteger(limit)||limit<0)throw new Error('Invalid NPC usage reservation');
  if(amount>limit)throw new GameError(`${provider==='near-ai'?'NEAR AI dialogue':'ElevenLabs voice'} is unavailable: the daily allowance has been reached.`,429);
  await this.initialize();const day=new Date(now).toISOString().slice(0,10);
  if(this.sql){
   const rows=await this.sql`INSERT INTO worldo_npc_usage(day,provider,amount) VALUES(${day}::date,${provider},${amount}) ON CONFLICT(day,provider) DO UPDATE SET amount=worldo_npc_usage.amount+EXCLUDED.amount WHERE worldo_npc_usage.amount+EXCLUDED.amount<=${limit} RETURNING amount`;
   if(!rows.length)throw new GameError(`${provider==='near-ai'?'NEAR AI dialogue':'ElevenLabs voice'} is unavailable: the daily allowance has been reached.`,429);
   return;
  }
  const file=path.join(this.directory,'npc-usage.json');
  await serialized(file,async()=>{
   let usage:DailyUsage={day,'near-ai':0,elevenlabs:0};
   try{
    const saved=JSON.parse(await readFile(file,'utf8')) as DailyUsage;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(saved.day)||!Number.isSafeInteger(saved['near-ai'])||saved['near-ai']<0||!Number.isSafeInteger(saved.elevenlabs)||saved.elevenlabs<0)throw new Error('Invalid NPC usage journal');
    if(saved.day===day)usage=saved;
    // A backwards clock must not create a second daily allowance.
    else if(saved.day>day)throw new Error('NPC usage clock moved backwards');
   }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(usage[provider]+amount>limit)throw new GameError(`${provider==='near-ai'?'NEAR AI dialogue':'ElevenLabs voice'} is unavailable: the daily allowance has been reached.`,429);
   usage[provider]+=amount;const temporary=`${file}.${randomUUID()}.tmp`;
   await writeFile(temporary,JSON.stringify(usage),{mode:0o600});await rename(temporary,file);
  });
 }
}
