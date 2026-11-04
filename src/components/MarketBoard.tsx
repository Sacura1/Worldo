import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Coins,TrendingUp,TrendingDown,Minus} from 'lucide-react';
import type {GameState,PlaceId,Resource} from '../../shared/types';
import {quoteTrade} from '../../shared/economy-rules';
import {getLiveQuote} from '../lib/api';
import {resourceIcons} from './Icons';

const GOODS:{resource:Resource;place:PlaceId;label:string}[]=[{resource:'petrol',place:'refinery',label:'Petrol'},{resource:'steel',place:'foundry',label:'Steel'},{resource:'planks',place:'sawmill',label:'Planks'}];
export function MarketBoard({state}:{state:GameState}){
 const [open,setOpen]=useState(()=>window.innerWidth>700);
 const [quoteResult,setQuoteResult]=useState<{mode:GameState['mode'];values:number[]}|null>(null),[quoteErrorMode,setQuoteErrorMode]=useState<GameState['mode']|null>(null);
 const pricesKey=GOODS.map(g=>`${g.place}:${state.merchants.find(m=>m.id===g.place)?.stock[g.resource]??0}`).join('|');
 const baseline=useRef<{mode:GameState['mode'];values:number[]}|null>(null),live=state.mode==='live';
 // Effects run after render. Tag every snapshot so a mode change cannot relabel
 // cached practice prices as NEAR while its new quotes are still loading.
 const prices=quoteResult?.mode===state.mode?quoteResult.values:null,unavailable=quoteErrorMode===state.mode;
 const initialPrices=baseline.current?.mode===state.mode?baseline.current.values:null;
 useEffect(()=>{let current=true;setQuoteErrorMode(null);const fetchPrices=async()=>{
  try{const next=live?await Promise.all(GOODS.map(g=>getLiveQuote(g.place,g.resource,1,'sell').then(q=>q.unitPrice))):GOODS.map(g=>quoteTrade(state,g.place,g.resource,1,'sell').unitPrice);
   if(!current)return;if(!baseline.current||baseline.current.mode!==state.mode)baseline.current={mode:state.mode,values:next};setQuoteResult({mode:state.mode,values:next});
  }catch{if(current){setQuoteResult(null);setQuoteErrorMode(state.mode);}}
 };void fetchPrices();return()=>{current=false;};},[pricesKey,state.mode,state.day,live]);
 return <section className={`market-board ${open?'is-open':''}`} aria-label="Town commodity prices"><button className="market-board-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}><Coins size={15}/><span>Town prices</span><ChevronDown size={14}/></button>{open&&<div className="market-board-body"><span className="market-caption">Merchants pay · per unit</span>{GOODS.map((good,index)=>{const Icon=resourceIcons[good.resource],value=prices?.[index],initial=initialPrices?.[index],delta=value!==undefined&&initial!==undefined?value-initial:0;return <div className="market-row" key={good.resource}><Icon size={16}/><span>{good.label}</span><strong>{value===undefined?'—':value.toLocaleString('en-US',{maximumFractionDigits:live?6:2})}</strong><span className={`market-change ${delta>.0000001?'up':delta<-.0000001?'down':''}`} aria-label={delta>.0000001?'Up since arrival':delta<-.0000001?'Down since arrival':'Unchanged since arrival'}>{delta>.0000001?<TrendingUp size={13}/>:delta<-.0000001?<TrendingDown size={13}/>:<Minus size={13}/>}</span></div>;})}<small>{unavailable?'Quotes temporarily unavailable':`${live?'NEAR':'Credits'} · change since arrival`}</small></div>}</section>;
}
