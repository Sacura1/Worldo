import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,LoaderCircle,RefreshCw,ShieldCheck} from 'lucide-react';
import {request,type ChainAction} from '../lib/api';
import {NearIcon} from './Icons';

export function exactNear(yocto:string):string{
 if(!/^\d+$/.test(yocto))return 'Unavailable';
 const digits=yocto.padStart(25,'0'),integer=digits.slice(0,-24),fraction=digits.slice(-24).replace(/0+$/,'');
 return integer+(fraction?'.'+fraction:'');
}
export interface ChainReceipt {hash:string;explorerUrl:string;}
export interface ActionCost {
 accountId:string;
 kind:'transaction'|'delegateAction';gasSponsored:boolean;attachedDepositPayer:'player'|'sponsor';
 attachedDepositYocto:string;gas:string;feeEstimateYocto:string;gasPriceYocto:string;estimatedAt:number;
}
function validCost(cost:ActionCost,action:ChainAction,accountId:string){
 const integer=(value:unknown)=>typeof value==='string'&&/^\d+$/.test(value);
 if(!integer(cost.attachedDepositYocto)||!integer(cost.feeEstimateYocto)||!integer(cost.gasPriceYocto)||!integer(cost.gas)||!Number.isFinite(cost.estimatedAt)||cost.estimatedAt<=0)return false;
 const native=action.method==='register'||action.method==='deposit';
 return cost.accountId===accountId&&BigInt(cost.attachedDepositYocto)===BigInt(action.deposit)&&cost.kind===(native?'transaction':'delegateAction')&&cost.gasSponsored===!native&&cost.attachedDepositPayer===(native?'player':'sponsor');
}

export function MainnetAction({action,accountId,busy,error,onConfirm,onCancel}:{action:ChainAction;accountId:string;busy:boolean;error:string;onConfirm:(cost:ActionCost)=>void;onCancel:()=>void}){
 const key=JSON.stringify({accountId,method:action.method,args:action.args,deposit:action.deposit,receiverId:action.receiverId});
 const [quote,setQuote]=useState<{key:string;cost:ActionCost;receiver:string;receivedAt:number}|null>(null),[loading,setLoading]=useState(true),[costError,setCostError]=useState(''),[now,setNow]=useState(Date.now());
 const generation=useRef(0);
 const loadCost=useCallback(async()=>{
  const requestGeneration=++generation.current;setLoading(true);setCostError('');setQuote(null);
  try{
   const payload=JSON.parse(key) as {accountId:string;method:string;args:Record<string,unknown>;deposit:string;receiverId?:string};
   const [cost,config]=await Promise.all([request<ActionCost>('/api/near/action-cost',{method:payload.method,args:payload.args,deposit:payload.deposit}),payload.receiverId?Promise.resolve({contractId:payload.receiverId}):request<{contractId:string|null}>('/api/near/status')]);
   if(requestGeneration!==generation.current)return;
   if(!validCost(cost,{...payload,label:''},payload.accountId)||!config.contractId)throw new Error('The transaction account, cost or destination could not be verified.');
   setQuote({key,cost,receiver:config.contractId,receivedAt:Date.now()});setNow(Date.now());
  }catch(e){if(requestGeneration===generation.current)setCostError(e instanceof Error?e.message:'Could not load transaction costs.');}
  finally{if(requestGeneration===generation.current)setLoading(false);}
 },[key]);
 useEffect(()=>{void loadCost();return()=>{generation.current++;};},[loadCost]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const current=quote?.key===key?quote:null,cost=current?.cost;
 // The server independently checks its two-minute window and refuses a higher
 // estimate at preparation/broadcast. No estimate is a protocol-level fee cap.
 const expired=!!current&&(now-current.receivedAt>=110000||now-current.cost.estimatedAt>=110000);
 const canConfirm=!!cost&&!loading&&!costError&&!expired&&!busy&&!error;
 const walletEstimate=cost?BigInt(cost.attachedDepositPayer==='player'?cost.attachedDepositYocto:'0')+BigInt(cost.gasSponsored?'0':cost.feeEstimateYocto):null;
 return <div className="panel-body live-review">
  <div className="live-review-heading"><NearIcon/><div><h3>{action.label}</h3><small>NEAR mainnet transaction</small></div></div>
  <dl className="live-transaction">
   <div><dt>From</dt><dd>{accountId}</dd></div><div><dt>Contract</dt><dd>{current?.receiver||action.receiverId||'Checking contract…'}</dd></div>
   {action.costYocto&&<div><dt>Game balance cost</dt><dd>{exactNear(action.costYocto)} NEAR</dd></div>}
   {action.receiveYocto&&<div><dt>Game balance receives</dt><dd>{exactNear(action.receiveYocto)} NEAR</dd></div>}
   <div><dt>Attached payment</dt><dd>{exactNear(action.deposit)} NEAR{cost&&<small><br/>{cost.attachedDepositPayer==='player'?'Paid by your wallet':'Paid by Worldo'}</small>}</dd></div>
   <div><dt>Estimated network allowance</dt><dd>{cost?exactNear(cost.feeEstimateYocto)+' NEAR':'Loading…'}{cost&&<small><br/>{cost.gasSponsored?'Sponsored by Worldo':'Paid by your wallet'}</small>}</dd></div>
   {walletEstimate!==null&&<div><dt>Estimated wallet debit</dt><dd>{exactNear(walletEstimate.toString())} NEAR</dd></div>}
  </dl>
  {cost&&!cost.gasSponsored&&<p className="fine-print">The network fee depends on gas used; unused gas is refunded. This is an estimate, not a guaranteed maximum. If the estimate increases before submission, reopen the action to review it again. The signing service is sponsored.</p>}
  {cost?.gasSponsored&&<p className="fine-print">Worldo sponsors the attached one yoctoNEAR and network fee. Any game-balance cost shown above still comes from your game account.</p>}
  <details className="live-transaction-details"><summary>Transaction details</summary><code>{action.method}</code><pre>{JSON.stringify(action.args,null,2)}</pre>{cost&&<small>{cost.kind==='transaction'?'Player-signed transaction':'Sponsored delegated transaction'} · {cost.gas} gas attached</small>}</details>
  <div className="note"><ShieldCheck size={18}/><p>Review the recipient, amount and who pays before signing. Balances and inventory update after confirmation.</p></div>
  {costError&&<p className="form-error" role="alert">{costError}</p>}{expired&&<p className="form-error" role="alert">This cost estimate expired. Refresh it before approving.</p>}{error&&<p className="form-error" role="alert">{error}</p>}
  {(costError||expired)&&!error&&<button className="button secondary full" disabled={busy||loading} onClick={()=>void loadCost()}><RefreshCw size={16}/>Refresh cost estimate</button>}
  <button className="button primary full" disabled={!canConfirm} onClick={()=>{if(canConfirm&&cost)onConfirm(cost);}}>{busy||loading?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>} {busy?'Waiting for confirmation…':loading?'Checking transaction costs…':'Confirm and sign'}</button>
  <button className="button secondary full" disabled={busy} onClick={onCancel}>{error?'Close review and check your account':'Cancel'}</button>
 </div>;
}
export function ReceiptLink({receipt}:{receipt:ChainReceipt}){return <a className="transaction-receipt" href={receipt.explorerUrl} target="_blank" rel="noopener noreferrer"><Check size={14}/>Confirmed on NEAR<ArrowUpRight size={14}/></a>;}
