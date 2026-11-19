/**
 * Privy identity-token verification for server-side routes.
 * The client sends `Authorization: Bearer <identity token>`; the token is a
 * Privy-signed JWT verified against Privy's JWKS.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './db';

const JWKS = createRemoteJWKSet(new URL('https://auth.privy.io/.well-known/jwks.json'));
const PRIVY_APP_ID = process.env.PRIVY_APP_ID ?? process.env.PUBLIC_PRIVY_APP_ID;

export interface PrivyCaller {
  userId: string;
}

export async function requirePrivyUser(request: Request): Promise<PrivyCaller> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new HttpError(401, 'missing authorization');

  try {
    const { payload } = await jwtVerify(match[1], JWKS, { issuer: 'privy.io' });
    if (PRIVY_APP_ID && payload.aud) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!aud.includes(PRIVY_APP_ID)) {
        throw new HttpError(401, 'token audience does not match this app');
      }
    }
    if (!payload.sub) throw new HttpError(401, 'token has no subject');
    return { userId: payload.sub };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'invalid identity token');
  }
}
