/**
 * Send USDC from the player's Privy embedded wallet to the treasury and wait
 * for the receipt. Returns the tx hash the server verifies on-chain.
 */
import { useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, erc20Abi, getAddress, type Hash } from 'viem';
import { chain, publicClient, readUsdcBalance, usdcAddress, formatUsdc } from '../../lib/arc';

/** Gas on Arc is paid from the same USDC balance; keep a little headroom. */
const GAS_HEADROOM = 50_000n; // 0.05 USDC

export function usePayUsdc() {
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];

  return useCallback(
    async (to: string, amount: bigint, onSent?: (hash: Hash) => void): Promise<Hash> => {
      if (!wallet) throw new Error('no wallet connected — sign in again');
      const balance = await readUsdcBalance(wallet.address);
      if (balance < amount + GAS_HEADROOM) {
        throw new Error(
          `not enough USDC: you have ${formatUsdc(balance)}, need ${formatUsdc(amount)} + ~${formatUsdc(GAS_HEADROOM)} for gas`,
        );
      }
      await wallet.switchChain(chain.id);
      const client = createWalletClient({
        account: getAddress(wallet.address),
        chain,
        transport: custom(await wallet.getEthereumProvider()),
      });
      const hash = await client.writeContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [getAddress(to), amount],
      });
      onSent?.(hash); // persist before waiting, the receipt wait can fail
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('payment failed on-chain');
      return hash;
    },
    [wallet],
  );
}
