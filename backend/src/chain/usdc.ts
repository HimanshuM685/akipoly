/**
 * Arc USDC: verify incoming transfers to the treasury and send payouts.
 * Network (testnet/mainnet) comes from ARC_NETWORK.
 */
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  type Address,
  type Chain,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arc as arcMainnet, arcTestnet } from 'viem/chains';
import { arc, env } from '../config/env.js';
import { AppError } from '../errors.js';

const chain: Chain = arc.network === 'mainnet' ? arcMainnet : arcTestnet;
const transport = http(arc.rpcUrl, { retryCount: 3, timeout: 15_000 });
const account = privateKeyToAccount(env.TREASURY_PRIVATE_KEY as Hash);

export const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ chain, transport, account });

export const treasuryAddress: Address = account.address;
const usdc = getAddress(arc.usdc);

const invalid = (m: string) => new AppError('PAYMENT_INVALID', m);

/**
 * Confirm that txHash is a successful USDC transfer of exactly `amount`
 * from `from` to the treasury. Replay protection (one use per hash) is the
 * caller's job via the chain_transfers primary key.
 */
export async function verifyIncomingTransfer(params: {
  txHash: Hash;
  from: string;
  amount: bigint;
}): Promise<void> {
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: params.txHash, timeout: 30_000 });
  } catch {
    throw invalid('transaction not found or not confirmed yet');
  }
  if (receipt.status !== 'success') throw invalid('transaction reverted');

  const from = getAddress(params.from);
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs }).filter(
    (l) =>
      getAddress(l.address) === usdc &&
      getAddress(l.args.from) === from &&
      getAddress(l.args.to) === treasuryAddress,
  );
  const total = transfers.reduce((sum, l) => sum + l.args.value, 0n);
  if (total !== params.amount) {
    throw invalid(`expected a USDC transfer of exactly ${params.amount} base units to the treasury`);
  }
}

/**
 * Sign (but do not broadcast) a USDC transfer from the treasury. Storing the
 * raw tx before broadcasting means a crash or RPC timeout can only ever
 * rebroadcast the same transaction, never send a second one.
 */
export async function signUsdcTransfer(to: string, amount: bigint): Promise<{ raw: Hex; hash: Hash }> {
  const request = await walletClient.prepareTransactionRequest({
    to: usdc,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [getAddress(to), amount] }),
  });
  const raw = await walletClient.signTransaction(request);
  return { raw, hash: keccak256(raw) };
}

export async function broadcast(raw: Hex): Promise<void> {
  await publicClient.sendRawTransaction({ serializedTransaction: raw });
}

export async function transferStatus(hash: Hash): Promise<'success' | 'reverted' | 'unknown'> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return receipt.status;
  } catch {
    return 'unknown';
  }
}

export async function treasuryBalance(): Promise<bigint> {
  return publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [treasuryAddress],
  });
}
