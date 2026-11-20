/**
 * Send USDC from the player's Privy embedded wallet to the treasury and wait
 * for the receipt. Returns the tx hash the server verifies on-chain.
 */
import { useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { createWalletClient, custom, erc20Abi, getAddress, type Hash } from 'viem';
import { chain, publicClient, readUsdcBalance, usdcAddress, formatUsdc } from '../../lib/arc';

export function usePayUsdc() {
  const { wallets } = useWallets();
  const wallet = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];

  return useCallback(
    async (to: string, amount: bigint): Promise<Hash> => {
      if (!wallet) throw new Error('no wallet connected — sign in again');
      const balance = await readUsdcBalance(wallet.address);
      if (balance < amount) {
        throw new Error(`not enough USDC: you have ${formatUsdc(balance)}, need ${formatUsdc(amount)} plus a little for gas`);
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
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('payment failed on-chain');
      return hash;
    },
    [wallet],
  );
}
