import type {GameAction,GameState} from '../../shared/types';
export async function request<T>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','x-request-id':crypto.randomUUID()},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'The town is unreachable. Please try again.');return result;
}
export type WorldMode='demo'|'live';
export interface ChainAction {method:string;args:Record<string,unknown>;deposit:string;label:string;receiverId?:string;costYocto?:string;receiveYocto?:string;}
export interface ActionResult {state:GameState;chainAction?:ChainAction;}
export interface LiveQuote {unitPrice:number;total:number;totalYocto:string;reason:string;}
export const getSession=(mode:WorldMode='demo')=>request<GameState>(mode==='live'?'/api/live/session':'/api/session');
export const sendAction=(action:GameAction)=>request<GameState>('/api/action',action);
export const performAction=async(action:GameAction,mode:WorldMode):Promise<ActionResult>=>mode==='live'?request<ActionResult>('/api/live/action',action):{state:await sendAction(action)};
export const getLiveQuote=(merchant:string,resource:string,quantity:number,side:'buy'|'sell')=>request<LiveQuote>('/api/live/quote',{merchant,resource,quantity,side});
