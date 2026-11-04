import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {canonicalAppOrigin,nearAuthConfiguration,nearAuthDerivationPath} from '../server/near-config';
import {encodeChallenge} from '../server/near';

const auth=vi.hoisted(()=>({popup:vi.fn(),claims:vi.fn(),logout:vi.fn(),constructor:vi.fn()}));
vi.mock('@auth0/auth0-spa-js',()=>({Auth0Client:class{
 constructor(options:unknown){auth.constructor(options);}
 getTokenWithPopup=auth.popup;getIdTokenClaims=auth.claims;logout=auth.logout;
}}));
import {NearAuthProvider,type NearAuthOptions} from '../src/lib/near-provider';
const options:NearAuthOptions={clientId:'approved-app',domain:'approved.auth0.com',audience:'approved-signing-api',guardId:'jwt#https://approved.auth0.com/',appOrigin:'https://lowland.example'};
const token=(fatxn:unknown,sub='google-oauth2|player')=>`header.${Buffer.from(JSON.stringify({sub,fatxn})).toString('base64url')}.signature`;
beforeEach(()=>{vi.clearAllMocks();auth.claims.mockResolvedValue({sub:'google-oauth2|player'});auth.popup.mockImplementation(async({authorizationParams:p})=>token(p.delegateAction??p.nep413??p.transaction));});
afterEach(()=>vi.unstubAllGlobals());

describe('trusted production auth configuration',()=>{
 it('uses official mainnet defaults without making sign-in configured',()=>{
  const c=nearAuthConfiguration({NEAR_NETWORK:'mainnet'});expect(c.clientId).toBeNull();expect(c.issuer).toBe('https://login.auth.near.org/');expect(c.audience).toBe('auth0.jwt.fast-auth.near');
 });
 it.each(['mainnet','testnet'])('derives the %s profile when optional auth values are blank',network=>{
  const c=nearAuthConfiguration({NEAR_NETWORK:network,NEAR_AUTH_CLIENT_ID:' ',NEAR_AUTH_DOMAIN:'',NEAR_AUTH_AUDIENCE:'  ',NEAR_AUTH_GUARD_ID:''});
  const domain=network==='testnet'?'login.testnet.fast-auth.com':'login.auth.near.org';
  expect(c).toMatchObject({domain,issuer:`https://${domain}/`,guardId:`jwt#https://${domain}/`,audience:network==='testnet'?'auth0.jwt.fast-auth.testnet':'auth0.jwt.fast-auth.near',clientId:network==='testnet'?'np8paqIpMWmNbzT4xAvOOapZBjsOpptl':null});
 });
 it.each(['mainnet','testnet'])('rejects each opposite-network official auth value on %s',network=>{
  const oppositeDomain=network==='mainnet'?'login.testnet.fast-auth.com':'login.auth.near.org';
  const oppositeAudience=network==='mainnet'?'auth0.jwt.fast-auth.testnet':'auth0.jwt.fast-auth.near';
  const changes=[{NEAR_AUTH_DOMAIN:`https://${oppositeDomain.toUpperCase()}/`},{NEAR_AUTH_AUDIENCE:oppositeAudience},{NEAR_AUTH_GUARD_ID:`jwt#https://${oppositeDomain.toUpperCase()}/`}];
  for(const change of changes)expect(()=>nearAuthConfiguration({NEAR_NETWORK:network,NEAR_AUTH_CLIENT_ID:'approved-app',...change})).toThrow('does not match the selected network');
 });
 it.each(['np8paqIpMWmNbzT4xAvOOapZBjsOpptl','dsurLc47fOcWme5PkYeClBvuW0tYrmgW'])('rejects shared or example client %s on mainnet',clientId=>{
  expect(()=>nearAuthConfiguration({NEAR_NETWORK:'mainnet',NEAR_AUTH_CLIENT_ID:` ${clientId} `})).toThrow('approved mainnet application');
 });
 it.each(['mainnet','testnet'])('preserves custom approved auth configuration on %s',network=>{
  const c=nearAuthConfiguration({NEAR_NETWORK:network,NEAR_AUTH_CLIENT_ID:'approved-app',NEAR_AUTH_DOMAIN:'custom.auth0.com',NEAR_AUTH_AUDIENCE:'custom-signing-api',NEAR_AUTH_GUARD_ID:'jwt#custom-registered-guard'});
  expect(c).toMatchObject({clientId:'approved-app',domain:'custom.auth0.com',audience:'custom-signing-api',guardId:'jwt#custom-registered-guard'});
 });
 it('derives the account through the same approved guard used for signing',()=>{
  const c=nearAuthConfiguration({NEAR_AUTH_CLIENT_ID:'app',NEAR_AUTH_DOMAIN:'https://approved.auth0.com/',NEAR_AUTH_AUDIENCE:'approved-api',NEAR_AUTH_GUARD_ID:'jwt#approved-registered-guard',PUBLIC_URL:'https://lowland.example',NODE_ENV:'production'});
  expect(c.domain).toBe('approved.auth0.com');expect(c.audience).toBe('approved-api');expect(nearAuthDerivationPath('subject',c)).toBe('jwt#approved-registered-guard#subject');
 });
 it('rejects ambiguous callback origins and insecure production origins',()=>{
  expect(()=>canonicalAppOrigin({PUBLIC_URL:'https://one.example',APP_ORIGIN:'https://two.example'})).toThrow('same origin');
  expect(()=>canonicalAppOrigin({PUBLIC_URL:'http://lowland.example',NODE_ENV:'production'})).toThrow('HTTPS');
  expect(()=>canonicalAppOrigin({NODE_ENV:'production'})).toThrow('PUBLIC_URL');
  expect(canonicalAppOrigin({PUBLIC_URL:'https://lowland.example/',APP_ORIGIN:'https://lowland.example'})).toBe('https://lowland.example');
 });
 it('rejects an issuer URL with credentials, a path, or insecure protocol',()=>{
  for(const domain of ['https://person:secret@approved.auth0.com','https://approved.auth0.com/path','http://approved.auth0.com'])expect(()=>nearAuthConfiguration({NEAR_AUTH_DOMAIN:domain})).toThrow();
 });
});

describe('fresh payload-bound browser authorization',()=>{
 it('retrieves the popup token for the exact scope and consumes it once',async()=>{
  const p=new NearAuthProvider(options);await p.requestEncodedDelegateSignature([1,2,255]);
  expect(auth.popup).toHaveBeenCalledWith({authorizationParams:{audience:options.audience,scope:'transaction:sign',redirect_uri:options.appOrigin,delegateAction:[1,2,255]}},undefined);
  const approval=await p.getSignatureRequest();expect([...approval.signatureRequest.signPayload]).toEqual([1,2,255]);expect(approval.signatureRequest.guardId).toBe(options.guardId);
  await expect(p.getSignatureRequest()).rejects.toThrow('Approve the current action');
 });
 it('rejects an older cached fatxn instead of authorizing another action',async()=>{
  const p=new NearAuthProvider(options);await p.requestEncodedDelegateSignature([1]);await p.getSignatureRequest();auth.popup.mockResolvedValueOnce(token([1]));
  await expect(p.requestEncodedDelegateSignature([2])).rejects.toThrow('does not match');await expect(p.getSignatureRequest()).rejects.toThrow('Approve');
 });
 it('rejects a token for a different authenticated subject',async()=>{
  auth.popup.mockResolvedValueOnce(token([1],'another-player'));const p=new NearAuthProvider(options);await expect(p.requestEncodedDelegateSignature([1])).rejects.toThrow('different sign-in');
 });
 it('clears earlier authorization when a new popup fails',async()=>{
  const p=new NearAuthProvider(options);await p.requestEncodedDelegateSignature([1]);auth.popup.mockRejectedValueOnce(new Error('Popup closed'));await expect(p.requestEncodedDelegateSignature([2])).rejects.toThrow('Popup closed');await expect(p.getSignatureRequest()).rejects.toThrow('Approve');
 });
 it('prevents overlapping approvals sharing a cache entry',async()=>{
  let finish!:(token:string)=>void;auth.popup.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve;}));const p=new NearAuthProvider(options);const first=p.requestEncodedDelegateSignature([1]);await expect(p.requestEncodedDelegateSignature([2])).rejects.toThrow('current authorization');finish(token([1]));await first;expect([...((await p.getSignatureRequest()).signatureRequest.signPayload)]).toEqual([1]);
 });
 it('serializes the login challenge identically to the server',async()=>{
  const c={message:'Sign in to Lowland.',recipient:'lowland.example',nonce:[...Array(32).keys()],expiresAt:Date.now()+1000};const p=new NearAuthProvider(options);await p.requestMessageSignature({...c,nonce:Uint8Array.from(c.nonce)});expect(Buffer.from((await p.getSignatureRequest()).signatureRequest.signPayload)).toEqual(encodeChallenge(c));
 });
 it('uses the configured logout origin and rejects sign-in on another host',async()=>{
  const p=new NearAuthProvider(options);await p.logout();expect(auth.logout).toHaveBeenCalledWith({logoutParams:{returnTo:options.appOrigin}});
  vi.stubGlobal('location',{origin:'https://other.example'});expect(()=>new NearAuthProvider(options)).toThrow('Open https://lowland.example');
 });
 it('passes through a window opened from the original mobile user gesture',async()=>{
  const popup={} as Window;const p=new NearAuthProvider(options);await p.requestEncodedDelegateSignature([1],popup);expect(auth.popup.mock.calls[0][1]).toEqual({popup});
 });
});
