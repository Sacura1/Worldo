import {jwtVerify, type JWTVerifyGetKey} from 'jose';
import {NEAR_AUTH_CLOCK_TOLERANCE_SECONDS} from './near-config';

/** Signature, issuer, signing audience and five-minute freshness remain required.
 * The relay additionally binds subject, authorized client and exact action bytes. */
export function verifyNearSigningToken(
  token: string,
  config: {issuer: string; audience: string},
  keys: JWTVerifyGetKey,
  currentDate?: Date,
) {
  return jwtVerify(token, keys, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ['RS256'],
    maxTokenAge: '5m',
    clockTolerance: NEAR_AUTH_CLOCK_TOLERANCE_SECONDS,
    ...(currentDate ? {currentDate} : {}),
  });
}
