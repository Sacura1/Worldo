// Adapter for the documented NEAR Auth message-signing flow. The published
// JavascriptProvider 1.4.1 predates requestMessageSignature. This implementation
// uses Auth0's public APIs and NEAR's NEP-413 serialization (not SDK internals).
import {Auth0Client} from '@auth0/auth0-spa-js';
type Message={message:string;recipient:string;nonce:Uint8Array;};
export type NearAuthOptions={clientId:string;domain:string;audience:string;guardId:string;appOrigin:string;};
type Approval={user:{userId:string};signatureRequest:{guardId:string;verifyPayload:string;signPayload:Uint8Array};};
export class NearAuthProvider {
 private client:Auth0Client;
 private approval:Approval|undefined;
 private requesting=false;
 constructor(private options:NearAuthOptions){
  if(globalThis.location&&globalThis.location.origin!==options.appOrigin)throw new Error(`Open ${options.appOrigin} to sign in.`);
  this.client=new Auth0Client({domain:options.domain,clientId:options.clientId,authorizationParams:{redirect_uri:options.appOrigin}});
 }
 async isLoggedIn(){return this.client.isAuthenticated();}
 async logout(){this.approval=undefined;await this.client.logout({logoutParams:{returnTo:this.options.appOrigin}});}
 private async user(){const claims=await this.client.getIdTokenClaims();if(!claims?.sub)throw new Error('Sign in first.');return{userId:claims.sub};}
 async getPath(){return `${this.options.guardId}#${(await this.user()).userId}`;}
 async requestMessageSignature(message:Message,popup?:Window){
  if(message.nonce.length!==32)throw new Error('Invalid login challenge.');
  const out:number[]=[];const u32=(n:number)=>out.push(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255);
  const text=(s:string)=>{const bytes=new TextEncoder().encode(s);u32(bytes.length);for(const b of bytes)out.push(b);};
  u32(2**31+413);text(message.message);out.push(...message.nonce);text(message.recipient);out.push(0);
  return this.request({nep413:out},popup);
 }
 async requestEncodedTransactionSignature(payload:number[],popup?:Window){return this.request({transaction:payload},popup);}
 async requestEncodedDelegateSignature(payload:number[],popup?:Window){return this.request({delegateAction:payload},popup);}
 private async request(payload:Record<string,number[]>,popup?:Window){
  if(this.requesting)throw new Error('Finish the current authorization first.');
  this.requesting=true;this.approval=undefined;
  try{
   const expected=Object.values(payload)[0];
   if(!expected?.length||expected.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error('Invalid authorization payload.');
   // Official NEAR Auth parameters are byte arrays. Auth0 serializes them as
   // comma-separated URL values. getTokenWithPopup always runs popup approval
   // and then reads its exact audience + scope cache key; never silently refresh
   // a transaction token or retrieve an unrelated cached login authorization.
   const token=await this.client.getTokenWithPopup({authorizationParams:{audience:this.options.audience,scope:'transaction:sign',redirect_uri:this.options.appOrigin,...payload}},popup?{popup}:undefined);
   if(!token)throw new Error('No authorization token returned.');
   const segment=token.split('.')[1];if(!segment)throw new Error('Invalid authentication response.');
   const encoded=segment.replace(/-/g,'+').replace(/_/g,'/');
   const bytes=Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length/4)*4,'=')),c=>c.charCodeAt(0));
   const data=JSON.parse(new TextDecoder().decode(bytes)) as {fatxn?:unknown;sub?:string};
   const actual=data.fatxn;
   if(!Array.isArray(actual)||actual.length!==expected.length||actual.some((n,i)=>n!==expected[i]))throw new Error('Authorization does not match the current action. Please approve it again.');
   const user=await this.user();
   if(data.sub!==user.userId)throw new Error('The authorization belongs to a different sign-in.');
   // Decoding only checks transport consistency; server and NEAR guard verify JWT.
   this.approval={user,signatureRequest:{guardId:this.options.guardId,verifyPayload:token,signPayload:Uint8Array.from(actual)}};
   return user;
  }finally{this.requesting=false;}
 }
 async getSignatureRequest(){
  const approval=this.approval;this.approval=undefined;
  if(!approval)throw new Error('Approve the current action first.');
  return approval;
 }
}
