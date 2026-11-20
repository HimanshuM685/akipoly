import { createRemoteJWKSet, jwtVerify } from 'jose';

let jwks = null;
let appId = null;

export function initAuth(privyAppId) {
  appId = privyAppId;
  jwks = createRemoteJWKSet(
    new URL(`https://auth.privy.io/api/v1/apps/${privyAppId}/jwks.json`)
  );
}

export async function verifyPrivyToken(token) {
  if (!jwks || !appId) {
    throw new Error('Auth not initialized');
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: 'privy.io',
      audience: appId,
      algorithms: ['ES256'],
    });

    if (!payload.sub) {
      throw new Error('Token has no subject');
    }

    return { userId: payload.sub };
  } catch (err) {
    console.error('[auth] verify failed:', err);
    throw new Error('Invalid identity token');
  }
}

export function getAppId() {
  return appId;
}
