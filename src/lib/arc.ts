/**
 * Client-side Arc network config, picked by PUBLIC_ARC_NETWORK
 * (testnet | mainnet). Must match the game server's ARC_NETWORK.
 */
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseAbi, parseUnits, type Chain } from 'viem';
import { arc as arcMainnet, arcTestnet } from 'viem/chains';
import { ARC_NETWORKS, USDC_DECIMALS, isArcNetwork } from '@shared/arc';
import { AKIPOLY_ROUNDS_ABI, gameIdToBytes16 } from '@shared/vrf';

const requested = import.meta.env.PUBLIC_ARC_NETWORK as string | undefined;
export const network = ARC_NETWORKS[isArcNetwork(requested) ? requested : 'testnet'];
export const chain: Chain = network.network === 'mainnet' ? arcMainnet : arcTestnet;
export const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
export const usdcAddress = getAddress(network.usdc);

/** Base units (6dp) → "1.5". */
export function formatUsdc(baseUnits: string | bigint): string {
  const s = formatUnits(BigInt(baseUnits), USDC_DECIMALS);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** "1.5" → base units, or null if not a valid amount. */
export function parseUsdc(value: string): bigint | null {
  const v = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(v)) return null;
  return parseUnits(v, USDC_DECIMALS);
}

export function readUsdcBalance(address: string): Promise<bigint> {
  return publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
}

export const txUrl = (hash: string) => `${network.explorerUrl}/tx/${hash}`;
export const addressUrl = (address: string) => `${network.explorerUrl}/address/${address}`;

const roundsAbi = parseAbi(AKIPOLY_ROUNDS_ABI);

/** A ReadDraw for src/lib/fairness.ts: AkipolyRounds.drawOf straight from Arc (not via our server). */
export const readRoundDraw = (roundsAddress: string) => (gameId: string, roundNumber: number) =>
  publicClient.readContract({
    address: getAddress(roundsAddress),
    abi: roundsAbi,
    functionName: 'drawOf',
    args: [gameIdToBytes16(gameId), roundNumber],
  });
