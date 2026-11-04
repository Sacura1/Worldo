export interface NearIdentity {accountId:string;publicKey:string;expiresAt:number;}
type AuthConfig={authConfigured:boolean;clientId:string|null;authDomain:string;authAudience:string;authGuardId:string;appOrigin:string;};
let providerPromise:Promise<import('./near-provider').NearAuthProvider>|undefined;
async function api<T>(path:string,body?:unknown):Promise<T>{const r=await fetch(`/api/near/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error||'NEAR sign-in unavailable.');return data as T;}
async function provider(){
 if(!providerPromise)providerPromise=(async()=>{
  const config=await api<AuthConfig>('status');
  if(!config.authConfigured||!config.clientId)throw new Error('Mainnet sign-in is awaiting NEAR Auth production access.');
  const {NearAuthProvider}=await import('./near-provider');
  return new NearAuthProvider({clientId:config.clientId,domain:config.authDomain,audience:config.authAudience,guardId:config.authGuardId,appOrigin:config.appOrigin});
 })().catch(error=>{providerPromise=undefined;throw error;});
 return providerPromise;
}
export async function getNearIdentity():Promise<NearIdentity|null>{return(await api<{identity:NearIdentity|null}>('identity')).identity;}
function authorizationWindow(){
 // Open synchronously from the confirm click, before network requests. Mobile
 // browsers may block a popup first created after async challenge preparation.
 const popup=window.open('about:blank','_blank','popup=yes,width=500,height=680');
 if(!popup)throw new Error('Allow the NEAR sign-in popup, then try again.');
 popup.document.title='NEAR authorization';popup.document.body.textContent='Connecting to NEAR Auth…';
 return popup;
}
export async function loginNear():Promise<NearIdentity>{
 const popup=authorizationWindow();
 try{
 const auth=await provider();
 const challenge=await api<{message:string;recipient:string;nonce:number[]}>('challenge',{});
 // NEAR Auth signs the exact app/session challenge; the server verifies the Auth0
 // signature and derives the account itself. A client-supplied account is never trusted.
 await auth.requestMessageSignature({message:challenge.message,recipient:challenge.recipient,nonce:Uint8Array.from(challenge.nonce)},popup);
 const {signatureRequest}=await auth.getSignatureRequest();
 return(await api<{identity:NearIdentity}>('verify',{token:signatureRequest.verifyPayload})).identity;
 }finally{popup.close();}
}
export async function logoutNear(){await api('logout',{});const auth=await provider();providerPromise=undefined;await auth.logout();}

/** Call only from an explicit user confirmation showing method, amount and fee. */
export async function sendNearAction(method:string,args:Record<string,unknown>,depositYocto='1',approvedCost?:{feeEstimateYocto:string;estimatedAt:number;accountId:string}){
 const popup=authorizationWindow();
 try{
 const prepared=await api<{id:string;payload:number[];kind:'transaction'|'delegateAction'}>('prepare-action',{method,args,deposit:depositYocto,approvedCost});
 const auth=await provider();
 if(prepared.kind==='transaction')await auth.requestEncodedTransactionSignature(prepared.payload,popup);
 else if(prepared.kind==='delegateAction')await auth.requestEncodedDelegateSignature(prepared.payload,popup);
 else throw new Error('Unsupported transaction authorization.');
 const {signatureRequest}=await auth.getSignatureRequest();
 const receipt=await api<{hash:string;explorerUrl:string;outcome:{status:unknown}}>('relay',{id:prepared.id,token:signatureRequest.verifyPayload});
 if(receipt.outcome.status&&typeof receipt.outcome.status==='object'&&'Failure'in receipt.outcome.status)throw new Error(`Game action failed on-chain. Receipt: ${receipt.explorerUrl}`);
 return receipt;
 }finally{popup.close();}
}
