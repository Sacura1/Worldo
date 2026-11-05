/** World sounds are synthesized locally. No audio request or billable provider is
 * involved; NPC voices have their own player and duck this bus while speaking. */
export interface GameAudioFrame {
 elapsed:number;distance:number;speed:number;throttle:number;driving:boolean;
 engineOn:boolean;paused:boolean;indoors:boolean;collision:number;x:number;z:number;
}
export type GameSoundEffect='door'|'gather'|'trade'|'process'|'refuel'|'survey'|'success'|'error'|'vehicle-enter'|'vehicle-exit'|'collision';
export type AudioPreferences={muted:boolean;volume:number};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
type VisibilityLike=Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>;
type Dependencies={createContext?:()=>AudioContext;storage?:StorageLike|null;document?:VisibilityLike|null};
const preferenceKey='worldo.sound';
const clamp=(value:number,min=0,max=1)=>Number.isFinite(value)?Math.max(min,Math.min(max,value)):min;
function browserStorage():StorageLike|null{try{return typeof localStorage==='undefined'?null:localStorage;}catch{return null;}}
export function readAudioPreferences(storage:StorageLike|null=browserStorage()):AudioPreferences{
 try{const saved=JSON.parse(storage?.getItem(preferenceKey)??'null');return{muted:typeof saved?.muted==='boolean'?saved.muted:false,volume:typeof saved?.volume==='number'?clamp(saved.volume):.65};}
 catch{return{muted:false,volume:.65};}
}

type Voice={source:AudioScheduledSourceNode;nodes:AudioNode[]};
type Graph={master:GainNode;scene:GainNode;engine:GainNode;wind:GainNode;road:GainNode;mechanism:GainNode;exhaust:GainNode;engineFilter:BiquadFilterNode;fundamental:OscillatorNode;harmonic:OscillatorNode;noise:AudioBuffer;nodes:AudioNode[];sources:AudioScheduledSourceNode[]};

export class GameAudio {
 private preferences:AudioPreferences;
 private storage:StorageLike|null;
 private visibility:VisibilityLike|null;
 private context?:AudioContext;
 private graph?:Graph;
 private disposed=false;
 private enabledByGesture=false;
 private active=false;
 private paused=true;
 private speaking=false;
 private contextChange?:Promise<void>;
 private voices=new Set<Voice>();
 private footsteps=0;
 private stepDistance=0;
 private birdClock=5;
 private collisionAt=-Infinity;
 private effects=new Map<GameSoundEffect,number>();
 private rpm=0;
 private readonly visibilityChanged=()=>{if(this.visibility?.visibilityState==='hidden'){this.stopVoices();this.silenceLoops();}this.syncContext();};
 constructor(private dependencies:Dependencies={}){
  this.storage=dependencies.storage===undefined?browserStorage():dependencies.storage;
  this.visibility=dependencies.document===undefined?(typeof document==='undefined'?null:document):dependencies.document;
  this.preferences=readAudioPreferences(this.storage);
  this.visibility?.addEventListener('visibilitychange',this.visibilityChanged);
 }
 get muted(){return this.preferences.muted;}
 get volume(){return this.preferences.volume;}
 get diagnostics(){return{unlocked:this.enabledByGesture,running:this.context?.state==='running',muted:this.muted,volume:this.volume,engineRpm:this.rpm,footsteps:this.footsteps,transientVoices:this.voices.size};}
 private save(){try{this.storage?.setItem(preferenceKey,JSON.stringify(this.preferences));}catch{/* Audio still works when browser storage is unavailable. */}}
 private allowed(){return!this.disposed&&this.enabledByGesture&&this.active&&!this.muted&&this.volume>0&&this.visibility?.visibilityState!=='hidden';}
 /** Must first be invoked directly from a click, touch or keyboard gesture. */
 async unlock():Promise<boolean>{
  if(this.disposed)return false;
  if(this.muted||this.volume<=0)return this.enabledByGesture;
  if(this.enabledByGesture&&this.context?.state!=='closed'){this.syncContext();return true;}
  try{
   if(!this.context){
    const Context=globalThis.AudioContext??(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    this.context=this.dependencies.createContext?.()??(Context?new Context():undefined);
    if(!this.context)return false;
    this.graph=this.createGraph(this.context);
   }
   // Invoke resume before yielding so Safari retains the trusted user gesture.
   await this.context.resume();this.enabledByGesture=this.context.state==='running';
   if(this.disposed){await this.context.close().catch(()=>{});return false;}
   this.syncContext();return this.enabledByGesture;
  }catch{return false;}
 }
 setMuted(value:boolean){this.preferences.muted=value;this.save();if(value){this.stopVoices();this.silenceLoops();}this.syncContext();}
 setVolume(value:number){this.preferences.volume=clamp(value);this.save();if(this.graph&&this.context)this.smooth(this.graph.master.gain,this.volume,this.context.currentTime,.03);if(!this.volume){this.stopVoices();this.silenceLoops();}this.syncContext();}
 setActive(value:boolean){this.active=value;if(!value){this.stopVoices();this.silenceLoops();this.stepDistance=0;}this.syncContext();}
 setVoiceActive(value:boolean){this.speaking=value;if(this.graph&&this.context)this.smooth(this.graph.scene.gain,value?.28:1,this.context.currentTime,.08);}
 private syncContext(){
  const context=this.context;if(!context||this.disposed||context.state==='closed'||this.contextChange)return;
  const running=this.allowed()&&(!this.paused||this.voices.size>0);
  if(running&&context.state!=='running'||!running&&context.state==='running'){
   let failed=false;this.contextChange=(running?context.resume():context.suspend()).catch(()=>{failed=true;}).finally(()=>{this.contextChange=undefined;if(!failed)this.syncContext();});
  }
 }
 private smooth(parameter:AudioParam,value:number,time:number,constant=.07){parameter.cancelScheduledValues(time);parameter.setTargetAtTime(value,time,constant);}
 private silenceLoops(){
  this.rpm=0;const graph=this.graph,context=this.context;if(!graph||!context)return;
  for(const node of[graph.engine,graph.exhaust,graph.wind,graph.road,graph.mechanism]){node.gain.cancelScheduledValues(context.currentTime);node.gain.setValueAtTime(0,context.currentTime);}
 }
 private createGraph(context:AudioContext):Graph{
  const nodes:AudioNode[]=[],sources:AudioScheduledSourceNode[]=[];
  const node=<T extends AudioNode>(value:T)=>{nodes.push(value);return value;};
  const gain=(value=0)=>{const g=node(context.createGain());g.gain.value=value;return g;};
  const filter=(type:BiquadFilterType,frequency:number,q=.7)=>{const f=node(context.createBiquadFilter());f.type=type;f.frequency.value=frequency;f.Q.value=q;return f;};
  const master=gain(this.volume),scene=gain(this.speaking?.28:1),compressor=node(context.createDynamicsCompressor());
  compressor.threshold.value=-18;compressor.knee.value=14;compressor.ratio.value=4;compressor.attack.value=.008;compressor.release.value=.18;
  scene.connect(master);master.connect(compressor);compressor.connect(context.destination);
  const noise=context.createBuffer(1,context.sampleRate*2,context.sampleRate),samples=noise.getChannelData(0);let seed=84673,last=0;
  for(let i=0;i<samples.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const white=seed/2147483648-1;last=(last+.035*white)/1.035;samples[i]=last*4;}
  const noiseLoop=(target:AudioNode)=>{const source=node(context.createBufferSource());source.buffer=noise;source.loop=true;source.connect(target);source.start();sources.push(source);};
  const oscillator=(type:OscillatorType,frequency:number,target:AudioNode)=>{const source=node(context.createOscillator());source.type=type;source.frequency.value=frequency;source.connect(target);source.start();sources.push(source);return source;};
  const engine=gain(),engineFilter=filter('lowpass',550);engine.connect(engineFilter);engineFilter.connect(scene);
  const fundamentalGain=gain(.64),harmonicGain=gain(.15);fundamentalGain.connect(engine);harmonicGain.connect(engine);
  const fundamental=oscillator('triangle',45,fundamentalGain),harmonic=oscillator('sawtooth',90,harmonicGain);
  const exhaust=gain(),exhaustFilter=filter('bandpass',180,.8);noiseLoop(exhaustFilter);exhaustFilter.connect(exhaust);exhaust.connect(scene);
  const wind=gain(),windFilter=filter('lowpass',380);noiseLoop(windFilter);windFilter.connect(wind);wind.connect(scene);
  const road=gain(),roadFilter=filter('bandpass',950,.5);noiseLoop(roadFilter);roadFilter.connect(road);road.connect(scene);
  const mechanism=gain();oscillator('sine',105,mechanism);mechanism.connect(scene);
  return{master,scene,engine,engineFilter,fundamental,harmonic,wind,road,mechanism,exhaust,noise,nodes,sources};
 }
 /** Motion comes from the resolved world position, never merely a held key. */
 update(frame:GameAudioFrame){
  this.paused=frame.paused;if(frame.paused)this.silenceLoops();this.syncContext();const context=this.context,graph=this.graph;
  if(!context||!graph||!this.allowed())return;
  const time=context.currentTime,speed=clamp(frame.speed,0,16),throttle=clamp(Math.abs(frame.throttle)),moving=!frame.paused&&frame.distance>.0001;
  const engine=!frame.paused&&frame.driving&&frame.engineOn;
  this.rpm=engine?750+speed*200+throttle*440:0;
  this.smooth(graph.engine.gain,engine?.063+throttle*.025:0,time,.1);
  this.smooth(graph.fundamental.frequency,engine?this.rpm/18:42,time,.1);
  this.smooth(graph.harmonic.frequency,engine?this.rpm/9+.4:84,time,.1);
  this.smooth(graph.engineFilter.frequency,engine?420+speed*42+throttle*340:400,time,.1);
  this.smooth(graph.exhaust.gain,engine?.018+throttle*.018:0,time,.1);
  this.smooth(graph.road.gain,engine&&moving?Math.min(.055,speed*.004):0,time,.1);
  this.smooth(graph.wind.gain,frame.paused?0:frame.indoors?.005:.022,time,.5);
  const industry=Math.max(0,1-Math.min(Math.hypot(frame.x-48,frame.z+29),Math.hypot(frame.x-40,frame.z-48),Math.hypot(frame.x+41,frame.z+28))/24);
  this.smooth(graph.mechanism.gain,frame.paused?0:industry*.008,time,.5);
  if(frame.paused){this.stepDistance=0;return;}
  if(!frame.driving&&moving){
   this.stepDistance+=clamp(frame.distance,0,2);
   if(this.stepDistance>=(speed>4.8?.95:.78)){this.stepDistance%=speed>4.8?.95:.78;this.footstep(frame.indoors,speed>4.8);this.footsteps++;}
  }else this.stepDistance=0;
  if(frame.driving&&frame.collision>.15&&time-this.collisionAt>.65){this.collisionAt=time;this.play('collision',frame.collision);}
  this.birdClock-=clamp(frame.elapsed,0,.25);
  if(this.birdClock<=0){this.birdClock=8+(Math.abs(frame.x+frame.z)%5);if(!frame.indoors&&!frame.driving)this.bird();}
 }
 private voice(source:AudioScheduledSourceNode,nodes:AudioNode[],duration:number){
  const context=this.context!;
  while(this.voices.size>=16)this.release(this.voices.values().next().value!);
  const voice={source,nodes};this.voices.add(voice);
  source.onended=()=>{this.release(voice,false);this.syncContext();};
  source.stop(context.currentTime+duration+.02);this.syncContext();
 }
 private release(voice:Voice,stop=true){voice.source.onended=null;if(stop)try{voice.source.stop();}catch{}for(const node of voice.nodes)node.disconnect();this.voices.delete(voice);}
 private stopVoices(){for(const voice of [...this.voices])this.release(voice);}
 private envelope(gain:GainNode,peak:number,duration:number,attack=.008){
  const now=this.context!.currentTime;gain.gain.setValueAtTime(.0001,now);gain.gain.linearRampToValueAtTime(peak,now+attack);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
 }
 private tone(frequency:number,end:number,duration:number,volume:number,type:OscillatorType='sine'){
  const context=this.context!,source=context.createOscillator(),gain=context.createGain();source.type=type;source.frequency.setValueAtTime(frequency,context.currentTime);source.frequency.exponentialRampToValueAtTime(end,context.currentTime+duration);this.envelope(gain,volume,duration);source.connect(gain);gain.connect(this.graph!.scene);source.start();this.voice(source,[source,gain],duration);
 }
 private noise(duration:number,volume:number,frequency:number,type:BiquadFilterType='bandpass'){
  const context=this.context!,source=context.createBufferSource(),gain=context.createGain(),filter=context.createBiquadFilter();source.buffer=this.graph!.noise;filter.type=type;filter.frequency.value=frequency;filter.Q.value=.6;this.envelope(gain,volume,duration,.006);source.connect(filter);filter.connect(gain);gain.connect(this.graph!.scene);source.start(0,(context.currentTime*.37)%1);this.voice(source,[source,filter,gain],duration);
 }
 private footstep(indoors:boolean,running:boolean){if(this.context?.state!=='running')return;this.noise(.105,running?.18:.12,indoors?1200:850);this.tone(indoors?110:90,55,.09,indoors?.048:.03,'triangle');}
 private bird(){if(this.context?.state!=='running')return;this.tone(2200,3300,.13,.007);}
 play(effect:GameSoundEffect,intensity=1){
  const context=this.context;if(!context||!this.graph||!this.allowed())return;
  const now=context.currentTime,minimum=effect==='collision'?.6:effect==='gather'?.12:.08;
  if(now-(this.effects.get(effect)??-Infinity)<minimum)return;this.effects.set(effect,now);
  const amount=clamp(intensity,.1,1);
  switch(effect){
   case'door':this.noise(.14,.2,420,'lowpass');this.tone(180,95,.25,.028,'triangle');break;
   case'vehicle-enter':case'vehicle-exit':this.noise(.13,.2,580,'lowpass');this.tone(95,48,.12,.08,'triangle');break;
   case'collision':this.noise(.16,.32*amount,500,'lowpass');this.tone(100,42,.18,.15*amount,'triangle');break;
   case'gather':this.noise(.13,.15,1500);this.tone(790,660,.15,.035,'triangle');this.tone(1220,1100,.1,.013);break;
   case'trade':this.tone(1150,1450,.14,.038);this.tone(1800,1900,.2,.018);break;
   case'process':this.noise(.55,.16,680);this.tone(115,145,.45,.04,'triangle');break;
   case'refuel':this.noise(.65,.14,1100);this.tone(230,160,.2,.02,'triangle');break;
   case'survey':this.tone(660,1150,.28,.034);break;
   case'success':this.tone(520,780,.2,.035);break;
   case'error':this.tone(180,135,.16,.03,'triangle');break;
  }
 }
 dispose(){
  if(this.disposed)return;this.disposed=true;this.active=false;this.visibility?.removeEventListener('visibilitychange',this.visibilityChanged);this.stopVoices();
  if(this.graph){for(const source of this.graph.sources)try{source.stop();}catch{}for(const node of this.graph.nodes)node.disconnect();this.graph=undefined;}
  if(this.context&&this.context.state!=='closed')void this.context.close().catch(()=>{});
 }
}
