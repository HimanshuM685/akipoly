/**
 * Privy identity-token verification for server-side routes.
 * The client sends `Authorization: Bearer <identity token>`; the token is a
 * Privy-signed JWT verified against Privy's JWKS.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from './db';

const JWKS = createRemoteJWKSet(new URL('https://auth.privy.io/.well-known/jwks.json'));

export interface PrivyCaller {
  userId: string;
}

export async function requirePrivyUser(request: Request): Promise<PrivyCaller> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new HttpError(401, 'missing authorization');

  try {
    const { payload } = await jwtVerify(match[1], JWKS);
    // Both identity and access tokens are Privy-signed JWTs; issuers differ
    // between the two, so accept any verified payload that carries a subject.
    if (!payload.sub) throw new HttpError(401, 'token has no subject');
    return { userId: payload.sub };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'invalid identity token');
  }
}
