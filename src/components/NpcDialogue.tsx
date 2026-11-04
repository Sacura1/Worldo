import {useEffect,useRef,useState} from 'react';
import {ArrowRight,MessageCircle,Send,ShoppingBag,Volume2,VolumeX,LoaderCircle} from 'lucide-react';
import type {GameState,PlaceId} from '../../shared/types';
import {SERVICE_NPCS,type ServiceNpc} from '../../shared/town';
import {request} from '../lib/api';

type Line={role:'user'|'assistant';content:string};
type Reply={text:string;suggestions?:string[];source:'near-ai'|'local'};
const introductions:Record<string,string>={
 morgan:'Morning! Morgan’s the name. Need supplies, a scanner, or a little help finding your feet?',
 hale:'Welcome to the refinery. Bring me crude, and we’ll put it to work. What are you hauling?',
 imani:'Mind the fresh sawdust! I’m Imani. Good timber becomes good buildings. What are you working on?',
 rosa:'Rosa, Eastbank Foundry. If it needs to last, build it in steel. What can I help you make?',
 'station-attendant':'Hey, I’m Theo. Park by a pump and stretch your legs. How’s the pickup treating you?',
};

/** A small character portrait, using the same clothing and complexion as the world. */
export function NpcPortrait({npcId,className=''}:{npcId:string;className?:string}){
 const index=Math.max(0,SERVICE_NPCS.findIndex(n=>n.id===npcId));
 const skin=['#c88d65','#805139','#84513b','#dfaa82','#c88d65'][index],shirt=['#467d8c','#c9793e','#a24b45','#c9793e','#467d8c'][index];
 const hair=index===0||index===3?'#53372b':'#272624',woman=index===2||index===3;
 return <svg className={`npc-portrait ${className}`} viewBox="0 0 160 180" role="img" aria-label={`${SERVICE_NPCS[index]?.name??'Resident'} portrait`}>
  <defs><linearGradient id={`portrait-${npcId}`} x2="0" y2="1"><stop stopColor="#526a4b"/><stop offset="1" stopColor="#24382c"/></linearGradient></defs>
  <path d="M12 17Q80-8 148 17V164Q80 190 12 164Z" fill={`url(#portrait-${npcId})`} stroke="#bc9756" strokeWidth="3"/>
  <circle cx="80" cy="69" r="47" fill="#e7c276" opacity=".1"/>
  {woman&&<path d="M43 60Q40 15 80 20Q122 15 118 72L128 122H33Z" fill={hair}/>}
  <path d="M25 168L32 126Q40 111 64 109H96Q122 112 129 128L136 168Z" fill={shirt}/>
  <path d="M67 96V115L80 125L94 113V95Z" fill={skin}/>
  <path d="M50 48Q80 25 110 48V80Q108 107 81 111Q52 106 50 80Z" fill={skin}/>
  <ellipse cx="49" cy="74" rx="6" ry="10" fill={skin}/><ellipse cx="111" cy="74" rx="6" ry="10" fill={skin}/>
  <path d="M48 59Q40 23 78 24Q114 20 113 59L99 45Q74 56 59 43Z" fill={hair}/>
  <path d="M59 65Q66 61 73 65M88 65Q96 61 103 66" stroke={hair} strokeWidth="3" fill="none" strokeLinecap="round"/>
  <ellipse cx="67" cy="72" rx="3" ry="4" fill="#262721"/><ellipse cx="96" cy="72" rx="3" ry="4" fill="#262721"/>
  <path d="M81 73L77 85H84" stroke="#704a34" strokeWidth="2" opacity=".55" fill="none" strokeLinecap="round"/>
  <path d="M69 94Q81 101 94 93" stroke="#714536" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
  {!woman&&index!==4&&<path d="M57 88Q60 112 81 113Q105 109 107 88Q98 102 81 101Q68 101 57 88Z" fill={hair} opacity=".65"/>}
  <path d="M60 111L79 126L68 143L51 116M98 111L81 126L92 143L110 117" fill="#f3dfb4" opacity=".75"/>
  <path d="M80 128V174" stroke="#172e2b" opacity=".45" strokeWidth="3"/>
  <rect x="101" y="142" width="19" height="18" rx="2" fill="#182e2b" opacity=".25"/>
  <circle cx="86" cy="147" r="2" fill="#e8c482"/><circle cx="86" cy="160" r="2" fill="#e8c482"/>
  {(index===1||index===3)&&<><path d="M45 49Q46 20 80 20Q113 21 116 49Z" fill="#e7b956"/><path d="M42 49H119" stroke="#a97832" strokeWidth="7" strokeLinecap="round"/><path d="M80 23V45" stroke="#f8d786" strokeWidth="8"/></>}
 </svg>;
}

export function NpcDialogue({npc,state,onTrade}:{npc:ServiceNpc;state:GameState;onTrade:(place:PlaceId)=>void}){
 const [lines,setLines]=useState<Line[]>([{role:'assistant',content:introductions[npc.id]??`Hello, I’m ${npc.name}. What brings you here?`}]);
 const [message,setMessage]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[source,setSource]=useState<'near-ai'|'local'>('local');
 const [suggestions,setSuggestions]=useState(['What do you buy?','How does your business work?','Any advice for a newcomer?']);
 const [voice,setVoice]=useState(()=>localStorage.getItem('worldo.npcVoice')!=='off');
 const conversation=useRef<HTMLDivElement>(null),alive=useRef(true),pendingRef=useRef(false);
 const speechAvailable=typeof window!=='undefined'&&'speechSynthesis'in window;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(speechAvailable)window.speechSynthesis.cancel();};},[speechAvailable]);
 useEffect(()=>{conversation.current?.scrollTo({top:conversation.current.scrollHeight,behavior:'smooth'});},[lines,pending]);
 function speak(text:string,force=false){
  if(!speechAvailable||(!voice&&!force))return;
  const synth=window.speechSynthesis;synth.cancel();const utterance=new SpeechSynthesisUtterance(text);
  const voices=synth.getVoices().filter(v=>v.lang.startsWith('en')),index=Math.max(0,SERVICE_NPCS.findIndex(n=>n.id===npc.id));
  if(voices.length)utterance.voice=voices[index%voices.length];utterance.rate=[.98,.9,1,.94,1.04][index]??1;utterance.pitch=[.95,.82,1.06,.96,1.04][index]??1;
  synth.speak(utterance);
 }
 async function send(text:string){
  const clean=text.trim();if(!clean||pendingRef.current)return;pendingRef.current=true;setPending(true);setError('');setMessage('');
  const history=lines.slice(-8).map(line=>({...line,content:line.content.slice(0,1000)}));setLines(previous=>[...previous,{role:'user',content:clean}]);
  try{const reply=await request<Reply>('/api/npc/chat',{npcId:npc.id,message:clean,history,mode:state.mode??'demo'});if(!alive.current)return;setLines(previous=>[...previous,{role:'assistant',content:reply.text}]);setSource(reply.source);if(reply.suggestions?.length)setSuggestions(reply.suggestions.slice(0,3));speak(reply.text);}
  catch(e){if(alive.current){setError(e instanceof Error?e.message:'Could not finish the conversation. Try again.');setMessage(clean);}}
  finally{pendingRef.current=false;if(alive.current)setPending(false);}
 }
 const latest=[...lines].reverse().find(line=>line.role==='assistant')?.content??'';
 return <div className="npc-dialogue">
  <aside className="npc-character-card"><NpcPortrait npcId={npc.id}/><span className="npc-nameplate"><strong>{npc.name}</strong><small>{npc.role}</small></span><span className="npc-location"><MessageCircle size={13}/>Here to talk</span></aside>
  <div className="npc-conversation">
   <div ref={conversation} className="dialogue-lines" role="log" aria-label={`Conversation with ${npc.name}`} aria-live="polite">{lines.map((line,index)=><div key={index} className={`dialogue-line ${line.role}`}><small>{line.role==='user'?'You':npc.name}</small><p>{line.content}</p></div>)}{pending&&<div className="dialogue-thinking"><LoaderCircle size={14} className="spin"/>{npc.name} is thinking…</div>}</div>
   {error&&<p role="alert" className="dialogue-error">{error}</p>}
   <div className="dialogue-suggestions">{suggestions.map(text=><button key={text} disabled={pending} onClick={()=>void send(text)}>{text}<ArrowRight size={12}/></button>)}</div>
   <form className="dialogue-compose" onSubmit={e=>{e.preventDefault();void send(message);}}><label className="sr-only" htmlFor="npc-message">Message {npc.name}</label><input id="npc-message" value={message} maxLength={600} autoComplete="off" placeholder={`Ask ${npc.name} something…`} onChange={e=>setMessage(e.target.value)} disabled={pending}/><button aria-label="Send message" disabled={pending||!message.trim()} type="submit"><Send size={18}/></button></form>
   <div className="dialogue-footer"><button className="button primary" onClick={()=>onTrade(npc.place)}><ShoppingBag size={16}/>{npc.id==='station-attendant'?'Petrol & supplies':'Browse goods & services'}</button><div className="dialogue-voice">{speechAvailable&&<><button aria-label={voice?'Turn NPC voice off':'Turn NPC voice on'} title={voice?'Turn voice off':'Turn voice on'} onClick={()=>{const next=!voice;setVoice(next);localStorage.setItem('worldo.npcVoice',next?'on':'off');if(!next)window.speechSynthesis.cancel();}}>{voice?<Volume2 size={16}/>:<VolumeX size={16}/>}</button><button className="listen-reply" onClick={()=>speak(latest,true)}>Listen</button></>}<small>{source==='near-ai'?'NEAR AI dialogue':'Local dialogue'}</small></div></div>
  </div>
 </div>;
}
