/**
 * Privy identity-token verification. The token is a Privy-signed ES256 JWT;
 * its `linked_accounts` claim carries the user's embedded wallet, which is
 * the only address we accept USDC from and pay out to.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getAddress } from 'viem';
import { env } from '../config/env.js';
import { AppError } from '../errors.js';

const jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${env.PRIVY_APP_ID}/jwks.json`));

interface LinkedAccount {
  type?: string;
  address?: string;
  chain_type?: string;
  chainType?: string;
  wallet_client_type?: string;
  walletClientType?: string;
}

function parseLinkedAccounts(claim: unknown): LinkedAccount[] {
  if (Array.isArray(claim)) return claim as LinkedAccount[];
  if (typeof claim === 'string') {
    try {
      const parsed = JSON.parse(claim);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function embeddedWalletFrom(claim: unknown): string | null {
  const wallets = parseLinkedAccounts(claim).filter(
    (a) => a.type === 'wallet' && (a.chain_type ?? a.chainType) === 'ethereum' && a.address,
  );
  const embedded = wallets.find((w) => (w.wallet_client_type ?? w.walletClientType) === 'privy') ?? wallets[0];
  return embedded?.address ? getAddress(embedded.address) : null;
}

export async function verifyIdentityToken(token: string): Promise<{ userId: string; walletAddress: string | null }> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: 'privy.io',
      audience: env.PRIVY_APP_ID,
      algorithms: ['ES256'],
    });
    if (!payload.sub) throw new Error('no subject');
    return { userId: payload.sub, walletAddress: embeddedWalletFrom(payload.linked_accounts) };
  } catch {
    throw new AppError('UNAUTHENTICATED', 'sign-in expired, please sign in again');
  }
}
