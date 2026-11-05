import type {Locale} from '../../shared/languages';
export type NpcSpeechRequest={npcId:string;replyId:string;mode:'demo'|'live';locale?:Locale};
export type NpcAudioState='idle'|'loading'|'playing';
type AudioHandle=Pick<HTMLAudioElement,'play'|'pause'|'src'|'onended'|'onerror'>;
type Dependencies={request:typeof fetch;createAudio:(url:string)=>AudioHandle;createUrl:(blob:Blob)=>string;revokeUrl:(url:string)=>void};

/** One voice at a time. Late responses cannot restart an interrupted conversation. */
export class NpcAudioPlayer {
 private generation=0;
 private abort?:AbortController;
 private audio?:AudioHandle;
 private url?:string;
 private cached?:{key:string;blob:Blob};
 constructor(private onState:(state:NpcAudioState,error?:string)=>void,private dependencies:Dependencies={request:(...args)=>fetch(...args),createAudio:url=>new Audio(url),createUrl:blob=>URL.createObjectURL(blob),revokeUrl:url=>URL.revokeObjectURL(url)}){}
 stop(){
  this.generation++;this.abort?.abort();this.abort=undefined;
  if(this.audio){this.audio.onended=null;this.audio.onerror=null;this.audio.pause();this.audio.src='';this.audio=undefined;}
  if(this.url){this.dependencies.revokeUrl(this.url);this.url=undefined;}
  this.onState('idle');
 }
 dispose(){this.stop();this.cached=undefined;}
 async play(body:NpcSpeechRequest){
  this.stop();const generation=this.generation,controller=new AbortController();this.abort=controller;this.onState('loading');
  const key=`${body.mode}:${body.npcId}:${body.replyId}:${body.locale??'en'}`;
  try{
   let blob=this.cached?.key===key?this.cached.blob:undefined;
   if(!blob){
    const response=await this.dependencies.request('/api/npc/speech',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(40000)])});
    if(!response.ok){const error=await response.json() as {error?:string};throw new Error(error.error??'The voice reply is unavailable.');}
    if(!response.headers.get('content-type')?.includes('audio/'))throw new Error('The voice reply is unavailable.');
    blob=await response.blob();if(blob.size>1024*1024)throw new Error('The voice reply is too large.');
   }
   if(generation!==this.generation||controller.signal.aborted)return;
   this.cached={key,blob};this.url=this.dependencies.createUrl(blob);this.audio=this.dependencies.createAudio(this.url);
   this.audio.onended=()=>{if(generation===this.generation)this.stop();};
   this.audio.onerror=()=>{if(generation===this.generation){this.stop();this.onState('idle','The voice could not play. Try Listen again.');}};
   await this.audio.play();if(generation===this.generation)this.onState('playing');
  }catch(error){
   if(generation!==this.generation||controller.signal.aborted)return;
   this.stop();const blocked=error instanceof Error&&error.name==='NotAllowedError';
   this.onState('idle',blocked?'Tap Listen to play this reply.':error instanceof Error?error.message:'The voice reply is unavailable.');
  }
 }
}
