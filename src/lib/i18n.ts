import {useSyncExternalStore} from 'react';
import {LANGUAGES,isLocale,languageInfo,normalizeLocale,type Locale} from '../../shared/languages';
import {appTranslations} from '../locales/app';
import {panelTranslations} from '../locales/panels';
import {npcTranslations} from '../locales/npc';
import {runtimeTranslations} from '../locales/runtime';

export {LANGUAGES,type Locale};
export type TranslationParams=Record<string,string|number>;
const catalogs=[appTranslations,panelTranslations,npcTranslations,runtimeTranslations];
export const messages=Object.fromEntries(LANGUAGES.map(({code})=>[code,Object.assign({},...catalogs.map(c=>c[code]))])) as Record<Locale,Record<string,string>>;
let locale:Locale='en';
try{locale=normalizeLocale(globalThis.localStorage?.getItem('worldo.language')||globalThis.navigator?.language);}catch{/* Storage can be disabled. */}
const listeners=new Set<()=>void>();
export const getLocale=()=>locale;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function documentLanguage(){if(typeof document!=='undefined'){document.documentElement.lang=languageInfo(locale).tag;document.documentElement.dir=languageInfo(locale).dir;}}
documentLanguage();
export function setLocale(next:Locale){if(!isLocale(next)||next===locale)return;locale=next;try{localStorage.setItem('worldo.language',next);}catch{}documentLanguage();for(const listener of listeners)listener();}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key==='worldo.language'&&isLocale(event.newValue))setLocale(event.newValue);});
export function formatNumber(value:number,options:Intl.NumberFormatOptions={}){return new Intl.NumberFormat(languageInfo(locale).tag,options).format(value);}
const interpolate=(value:string,params:TranslationParams)=>value.replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(params,key)?String(params[key]):match);
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=Object.keys(messages.en).filter(key=>/\{\w+\}/.test(key)&&key.replace(/\{\w+\}/g,'').length>=5).sort((a,b)=>b.replace(/\{\w+\}/g,'').length-a.replace(/\{\w+\}/g,'').length).map(key=>{
 const names=[...key.matchAll(/\{(\w+)\}/g)].map(match=>match[1]);
 const expression=new RegExp('^'+key.split(/\{\w+\}/).map(escape).join('(.+?)')+'$');return{key,names,expression};
});
/** Runtime phrases come from our own authoritative game/server strings. Never
 * apply this to account IDs, transaction payloads, addresses or AI-generated text. */
export function translate(message:string,selected:Locale,params:TranslationParams={}):string{
 if(typeof message!=='string')return message;
 const direct=messages[selected][message];if(direct!==undefined)return interpolate(direct,params);
 if(Object.keys(params).length)return interpolate(message,params);
 for(const pattern of patterns){const match=pattern.expression.exec(message);if(match){const values=Object.fromEntries(pattern.names.map((name,index)=>[name,translate(match[index+1],selected)]));return interpolate(messages[selected][pattern.key]||pattern.key,values);}}
 return message;
}
export function t(message:string|null|undefined,params:TranslationParams={}){return translate(message??'',locale,params);}
export function useI18n(){const current=useSyncExternalStore(subscribe,getLocale,()=> 'en' as Locale);return{locale:current,setLocale,t,formatNumber,dir:languageInfo(current).dir};}
