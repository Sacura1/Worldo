type Environment=Record<string,string|undefined>;

/** Only deployment configuration can select an issuer, guard or callback origin. */
export function canonicalAppOrigin(env:Environment=process.env):string{
 const normalize=(value:string)=>{
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('PUBLIC_URL and APP_ORIGIN must be plain HTTP(S) origins.');
  if(url.protocol!=='https:'&&(env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('The public app origin must use HTTPS.');
  return url.origin;
 };
 const publicOrigin=env.PUBLIC_URL?normalize(env.PUBLIC_URL):undefined;
 const appOrigin=env.APP_ORIGIN?normalize(env.APP_ORIGIN):undefined;
 if(publicOrigin&&appOrigin&&publicOrigin!==appOrigin)throw new Error('PUBLIC_URL and APP_ORIGIN must identify the same origin.');
 if(!publicOrigin&&!appOrigin&&env.NODE_ENV==='production')throw new Error('Set PUBLIC_URL to the production HTTPS origin.');
 return publicOrigin??appOrigin??'http://localhost:3000';
}

export function nearAuthConfiguration(env:Environment=process.env){
 const configured=env.NEAR_AUTH_DOMAIN?.trim()||'login.auth.near.org';
 const url=new URL(configured.includes('://')?configured:`https://${configured}`);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw new Error('NEAR_AUTH_DOMAIN must be an approved HTTPS issuer hostname.');
 const issuer=`${url.origin}/`;
 const audience=env.NEAR_AUTH_AUDIENCE?.trim()||'auth0.jwt.fast-auth.near';
 const guardId=env.NEAR_AUTH_GUARD_ID?.trim()||`jwt#${issuer}`;
 if(audience.length>512||/\s/.test(audience))throw new Error('Invalid NEAR Auth signing audience.');
 if(!guardId.startsWith('jwt#')||guardId.length>512||/\s/.test(guardId))throw new Error('Invalid NEAR Auth JWT guard identifier.');
 return{clientId:env.NEAR_AUTH_CLIENT_ID?.trim()||null,domain:url.hostname,issuer,audience,guardId,appOrigin:canonicalAppOrigin(env)};
}

export function nearAuthDerivationPath(subject:string,config=nearAuthConfiguration()){
 if(!subject)throw new Error('A verified authentication subject is required.');
 return `${config.guardId}#${subject}`;
}
