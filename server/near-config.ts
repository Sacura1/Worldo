export type Environment=Record<string,string|undefined>;
export function appMode(env:Environment=process.env):'production'|'development'{
 const mode=env.APP_MODE||(env.NODE_ENV==='production'?'production':'development');
 if(mode!=='production'&&mode!=='development')throw new Error('APP_MODE must be production or development.');
 return mode;
}
export function nearNetworkConfiguration(env:Environment=process.env){
 const network=env.NEAR_NETWORK||'testnet';
 if(network!=='mainnet'&&network!=='testnet')throw new Error('NEAR_NETWORK must be mainnet or testnet.');
 const testnet=network==='testnet';
 const rpcUrl=env.NEAR_RPC_URL||(testnet?'https://test.rpc.fastnear.com':'https://free.rpc.fastnear.com');
 const rpc=new URL(rpcUrl);
 const oppositeHosts=testnet?['free.rpc.fastnear.com','near.drpc.org','rpc.intea.rs']:['test.rpc.fastnear.com','near-testnet.drpc.org','testnet-rpc.intea.rs'];
 if(rpc.protocol!=='https:'||rpc.username||rpc.password||oppositeHosts.includes(rpc.hostname)||rpc.hostname.includes(testnet?'mainnet':'testnet'))throw new Error('NEAR_RPC_URL does not match the selected network.');
 return{network,testnet,rpcUrl,authContract:testnet?'fast-auth.testnet':'fast-auth.near',mpcContract:testnet?'v1.signer-prod.testnet':'v1.signer',wrappedToken:testnet?'wrap.testnet':'wrap.near',explorerUrl:testnet?'https://testnet.nearblocks.io':'https://nearblocks.io',faucetUrl:testnet?'https://near-faucet.io/':null,intentsEnabled:!testnet,chainEnabled:env[testnet?'ENABLE_TESTNET':'ENABLE_MAINNET']==='true'};
}
export function transactionExplorerUrl(hash:string){return `${nearNetworkConfiguration().explorerUrl}/txns/${hash}`;}
/** A private RPC URL can contain an API credential in its path or query. */
export function publicRpcUrl(value:string):string|null{const url=new URL(value);return url.pathname==='/'&&!url.search&&!url.hash?url.origin:null;}
export function testnetWalletEnabled(env:Environment=process.env){
 const {testnet}=nearNetworkConfiguration(env),mode=env.NEAR_AUTH_MODE||'social';
 if(!['testnet-wallet','social'].includes(mode)||(!testnet&&mode==='testnet-wallet'))throw new Error('Browser test wallets are available only on NEAR testnet.');
 return appMode(env)==='development'&&mode==='testnet-wallet';
}

/** Only deployment configuration can select an issuer, guard or callback origin. */
export function canonicalAppOrigin(env:Environment=process.env):string{
 const normalize=(value:string)=>{
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('PUBLIC_URL and APP_ORIGIN must be plain HTTP(S) origins.');
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&(!loopback||env.NODE_ENV==='production'&&(env.NEAR_NETWORK||'testnet')!=='testnet'))throw new Error('The public app origin must use HTTPS.');
  return url.origin;
 };
 const publicOrigin=env.PUBLIC_URL?normalize(env.PUBLIC_URL):undefined;
 const appOrigin=env.APP_ORIGIN?normalize(env.APP_ORIGIN):undefined;
 if(publicOrigin&&appOrigin&&publicOrigin!==appOrigin)throw new Error('PUBLIC_URL and APP_ORIGIN must identify the same origin.');
 if(!publicOrigin&&!appOrigin&&env.NODE_ENV==='production')throw new Error('Set PUBLIC_URL to the production HTTPS origin.');
 return publicOrigin??appOrigin??'http://localhost:3000';
}

export function nearAuthConfiguration(env:Environment=process.env){
 const {testnet}=nearNetworkConfiguration(env);
 const configured=env.NEAR_AUTH_DOMAIN?.trim()||(testnet?'login.testnet.fast-auth.com':'login.auth.near.org');
 const url=new URL(configured.includes('://')?configured:`https://${configured}`);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('NEAR_AUTH_DOMAIN must be an approved HTTPS issuer hostname.');
 const issuer=`${url.origin}/`;
 const audience=env.NEAR_AUTH_AUDIENCE?.trim()||(testnet?'auth0.jwt.fast-auth.testnet':'auth0.jwt.fast-auth.near');
 const guardId=env.NEAR_AUTH_GUARD_ID?.trim()||`jwt#${issuer}`;
 if(audience.length>512||/\s/.test(audience))throw new Error('Invalid NEAR Auth signing audience.');
 if(!guardId.startsWith('jwt#')||guardId.length>512||/\s/.test(guardId))throw new Error('Invalid NEAR Auth JWT guard identifier.');
 return{clientId:env.NEAR_AUTH_CLIENT_ID?.trim()||(testnet?'np8paqIpMWmNbzT4xAvOOapZBjsOpptl':null),domain:url.hostname,issuer,audience,guardId,appOrigin:canonicalAppOrigin(env)};
}

export function nearAuthDerivationPath(subject:string,config=nearAuthConfiguration()){
 if(!subject)throw new Error('A verified authentication subject is required.');
 return `${config.guardId}#${subject}`;
}

const rpcNetworkChecks=new Map<string,{expiresAt:number;result:Promise<{network:string;chainId:string;rpcUrl:string;verifiedAt:number}>}>();
/** Check the node's chain ID before any transaction or sponsored activation.
 * Cache briefly per configured network+URL, never cache errors or mismatches. */
export async function assertNearRpcNetwork(){
 const {network,rpcUrl}=nearNetworkConfiguration(),key=network+':'+rpcUrl,now=Date.now();
 const cached=rpcNetworkChecks.get(key);if(cached&&cached.expiresAt>now)return cached.result;
 const result=(async()=>{
  const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'worldo-network',method:'status',params:[]}),signal:AbortSignal.timeout(15000)});
  const body=await response.json() as {result?:{chain_id?:string};error?:unknown};
  if(!response.ok||body.error||!body.result?.chain_id)throw new Error('The NEAR RPC network could not be verified. No transaction was submitted.');
  if(body.result.chain_id!==network)throw new Error('The NEAR RPC chain ID does not match the selected network. No transaction was submitted.');
  return{network,chainId:body.result.chain_id,rpcUrl,verifiedAt:Date.now()};
 })().catch(error=>{rpcNetworkChecks.delete(key);throw error;});
 rpcNetworkChecks.set(key,{expiresAt:now+30000,result});return result;
}
