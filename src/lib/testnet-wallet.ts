import {KeyPair} from '@near-js/crypto';
import type {NearIdentity} from './near-auth';
const storageKey='worldo:testnet-wallet:v1';
async function api<T>(path:string,body?:unknown):Promise<T>{const response=await fetch(`/api/near/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error||'The testnet wallet is unavailable.');return result;}
async function testnetOnly(){const status=await api<{network:string;testnetWalletEnabled:boolean}>('status');if(status.network!=='testnet'||!status.testnetWalletEnabled)throw new Error('This local wallet can only sign on the configured testnet deployment.');}
function key(create=false){let encoded=localStorage.getItem(storageKey);if(!encoded){if(!create)throw new Error('Create your test wallet first.');encoded=KeyPair.fromRandom('ed25519').toString();localStorage.setItem(storageKey,encoded);}return KeyPair.fromString(encoded as `ed25519:${string}`);}
async function digest(bytes:number[]){return new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes)));}
export async function loginTestnetWallet():Promise<NearIdentity>{
 await testnetOnly();const pair=key(true),challenge=await api<{payload:number[]}>('testnet-challenge',{});
 const signature=pair.sign(await digest(challenge.payload)).signature;
 return(await api<{identity:NearIdentity}>('verify-testnet',{publicKey:pair.getPublicKey().toString(),signature:[...signature]})).identity;
}
export async function signTestnetAction(prepared:{id:string;payload:number[];network?:string;publicKey?:string;signingMode?:string}){
 await testnetOnly();if(prepared.network!=='testnet'||prepared.signingMode!=='testnet-wallet')throw new Error('Refusing a transaction outside the local testnet wallet.');
 const pair=key();if(prepared.publicKey!==pair.getPublicKey().toString())throw new Error('The reviewed account does not match this browser’s test wallet.');
 const signature=pair.sign(await digest(prepared.payload)).signature;
 return api<{hash:string;explorerUrl:string;outcome:{status:unknown}}>('relay',{id:prepared.id,signature:[...signature]});
}
