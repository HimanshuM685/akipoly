/**
 * Privy identity-token verification for server-side routes.
 * The client sends `Authorization: Bearer <identity token>`; tokens are
 * Privy-signed JWTs verified against the app's per-app JWKS endpoint.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './db';

const PRIVY_APP_ID =
  process.env.PRIVY_APP_ID ?? process.env.PUBLIC_PRIVY_APP_ID ?? import.meta.env?.PUBLIC_PRIVY_APP_ID;
const JWKS = PRIVY_APP_ID
  ? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`))
  : undefined;

export interface PrivyCaller {
  userId: string;
}

export async function requirePrivyUser(request: Request): Promise<PrivyCaller> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new HttpError(401, 'missing authorization');

  if (!JWKS || !PRIVY_APP_ID) {
    throw new HttpError(503, 'AUTH not configured on server');
  }

  try {
    const { payload } = await jwtVerify(match[1], JWKS, {
      issuer: 'privy.io',
      audience: PRIVY_APP_ID,
      algorithms: ['ES256'],
    });
    if (!payload.sub) throw new HttpError(401, 'token has no subject');
    return { userId: payload.sub };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[privy] verify failed:', err);
    throw new HttpError(401, 'invalid identity token');
  }
}
