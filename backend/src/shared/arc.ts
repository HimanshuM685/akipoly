/**
 * Arc network table, shared by the backend and the web client.
 * Dependency-free on purpose so the frontend can import it without pulling
 * server code. Source: https://docs.arc.io/arc/references/connect-to-arc
 */

export type ArcNetwork = 'testnet' | 'mainnet';

/** USDC ERC-20 interface on Arc uses 6 decimals (native gas view uses 18). */
export const USDC_DECIMALS = 6;

export interface ArcNetworkConfig {
  network: ArcNetwork;
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  /** ERC-20 interface over native USDC. Same address on both networks. */
  usdc: `0x${string}`;
  /** Where to get test funds; null on mainnet. */
  faucetUrl: string | null;
}

export const ARC_NETWORKS: Record<ArcNetwork, ArcNetworkConfig> = {
  testnet: {
    network: 'testnet',
    chainId: 5042002,
    name: 'Arc Testnet',
    rpcUrl: 'https://rpc.testnet.arc.io',
    explorerUrl: 'https://explorer.testnet.arc.io',
    usdc: '0x3600000000000000000000000000000000000000',
    faucetUrl: 'https://faucet.circle.com/',
  },
  mainnet: {
    network: 'mainnet',
    chainId: 5042,
    name: 'Arc',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerUrl: 'https://explorer.arc.io',
    usdc: '0x3600000000000000000000000000000000000000',
    faucetUrl: null,
  },
};

export function isArcNetwork(value: unknown): value is ArcNetwork {
  return value === 'testnet' || value === 'mainnet';
}
