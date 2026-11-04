import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Coins,TrendingUp,TrendingDown,Minus,RefreshCw} from 'lucide-react';
import type {GameState,PlaceId,Resource} from '../../shared/types';
import {quoteTrade} from '../../shared/economy-rules';
import {getLiveQuote} from '../lib/api';
import {NearIcon,resourceIcons} from './Icons';

const GOODS:{resource:Resource;place:PlaceId;label:string;merchant:string}[]=[{resource:'petrol',place:'refinery',label:'Petrol',merchant:'Worldo Refinery'},{resource:'steel',place:'foundry',label:'Steel',merchant:'Eastbank Foundry'},{resource:'planks',place:'sawmill',label:'Planks',merchant:'Pine & Co. Sawmill'}];
type Prices={scope:string;values:number[];updatedAt:number};
export function MarketBoard({state,network='mainnet'}:{state:GameState;network?:'mainnet'|'testnet'}){
 const [open,setOpen]=useState(()=>window.innerWidth>700),[quoteResult,setQuoteResult]=useState<Prices|null>(null),[quoteError,setQuoteError]=useState<string|null>(null),[refreshing,setRefreshing]=useState(false),[refreshId,setRefreshId]=useState(0);
 const baseline=useRef<Prices|null>(null),latestState=useRef(state);latestState.current=state;
 const live=state.mode==='live',scope=live?network+':'+(state.live?.accountId??''):'credits',unit=live?(network==='testnet'?'test NEAR':'NEAR'):'CR';
 const pricesKey=GOODS.map(g=>g.place+':'+(state.merchants.find(m=>m.id===g.place)?.stock[g.resource]??0)).join('|');
 const prices=quoteResult?.scope===scope?quoteResult.values:null,initial=baseline.current?.scope===scope?baseline.current.values:null,unavailable=quoteError===scope;
 useEffect(()=>{
  let active=true,inFlight=false;
  const update=async()=>{
   if(inFlight||document.hidden)return;inFlight=true;setRefreshing(true);
   try{
    const values=live?await Promise.all(GOODS.map(g=>getLiveQuote(g.place,g.resource,1,'sell').then(q=>q.unitPrice))):GOODS.map(g=>quoteTrade(latestState.current,g.place,g.resource,1,'sell').unitPrice);
    if(!active)return;if(values.some(value=>!Number.isFinite(value)||value<0))throw new Error('Invalid quote');
    const next={scope,values,updatedAt:Date.now()};if(baseline.current?.scope!==scope)baseline.current=next;setQuoteResult(next);setQuoteError(null);
   }catch{if(active){setQuoteResult(null);setQuoteError(scope);}}finally{inFlight=false;if(active)setRefreshing(false);}
  };
  void update();const interval=live&&open?setInterval(()=>void update(),20000):undefined;
  const resume=()=>{if(open&&!document.hidden)void update();};document.addEventListener('visibilitychange',resume);window.addEventListener('focus',resume);
  return()=>{active=false;if(interval)clearInterval(interval);document.removeEventListener('visibilitychange',resume);window.removeEventListener('focus',resume);};
 },[scope,pricesKey,state.day,live,open,refreshId]);
 return <section className={'market-board '+(open?'is-open':'')} aria-label="Town commodity prices">
  <button className="market-board-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}><Coins size={15}/><span>Town prices</span><span className="market-currency">{live&&<NearIcon/>}{unit}</span><ChevronDown size={14}/></button>
  {open&&<div className="market-board-body"><span className="market-caption">What shops pay you · per unit</span>
   {GOODS.map((good,index)=>{const Icon=resourceIcons[good.resource],value=prices?.[index],start=initial?.[index],delta=value!==undefined&&start!==undefined?value-start:0;return <div className="market-row" key={good.resource} title={good.merchant+' buys '+good.label.toLowerCase()}><Icon size={16}/><span>{good.label}</span><strong>{value===undefined?'—':value.toLocaleString('en-US',{maximumFractionDigits:live?6:2})}<small>{unit}</small></strong><span className={'market-change '+(delta>1e-7?'up':delta< -1e-7?'down':'')} aria-label={value===undefined?'Waiting for quote':delta>1e-7?'Up since arrival':delta< -1e-7?'Down since arrival':'Unchanged since arrival'}>{delta>1e-7?<TrendingUp size={13}/>:delta< -1e-7?<TrendingDown size={13}/>:<Minus size={13}/>}</span></div>;})}
   <div className="market-status"><small>{unavailable?'Prices unavailable':live?'Live offers · refresh every 20s':'Stock-based offers · changes since arrival'}</small><button disabled={refreshing} onClick={()=>setRefreshId(n=>n+1)} aria-label="Refresh town prices"><RefreshCw size={13} className={refreshing?'spin':''}/></button></div>
  </div>}
 </section>;
}
