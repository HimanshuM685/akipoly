import { createPublicClient, http, getAddress, formatUnits } from 'viem';
import { arcTestnet } from 'viem/chains';

let publicClient = null;
let usdcContract = null;
let operatorAddress = null;
let operatorPrivateKey = null;

export function initPayout(arcRpcUrl, usdcContractAddress, opPrivateKey, opAddress) {
  publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(arcRpcUrl),
  });
  usdcContract = usdcContractAddress;
  operatorPrivateKey = opPrivateKey;
  operatorAddress = opAddress;
}

export async function getUsdcBalance(address) {
  if (!publicClient || !usdcContract) return null;
  try {
    const balance = await publicClient.readContract({
      address: usdcContract,
      abi: [
        {
          inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
          name: 'balanceOf',
          outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function',
        },
      ],
      functionName: 'balanceOf',
      args: [getAddress(address)],
    });
    return formatUnits(balance, 6);
  } catch (err) {
    console.error('[payout] balance read failed:', err.message);
    return null;
  }
}

export async function transferUsdc(toAddress, amountUsdc) {
  if (!publicClient || !usdcContract || !operatorPrivateKey) {
    throw new Error('Payout module not initialized');
  }

  const amountWei = Math.floor(parseFloat(amountUsdc) * 1e6);

  try {
    // Note: In production, use a wallet client with the operator private key
    // to sign and send the transaction. This is a placeholder structure.
    console.log(`[payout] Would transfer ${amountUsdc} USDC to ${toAddress}`);

    // For actual sending, you need a viem WalletClient:
    // import { privateKeyToAccount } from 'viem/accounts';
    // import { createWalletClient } from 'viem';
    // const account = privateKeyToAccount(operatorPrivateKey);
    // const walletClient = createWalletClient({
    //   account,
    //   chain: arcTestnet,
    //   transport: http(arcRpcUrl),
    // });
    // const hash = await walletClient.writeContract({
    //   address: usdcContract,
    //   abi: [...transfer ABI...],
    //   functionName: 'transfer',
    //   args: [getAddress(toAddress), amountWei],
    // });

    return { txHash: '0xplaceholder', amount: amountUsdc };
  } catch (err) {
    console.error('[payout] transfer failed:', err.message);
    throw err;
  }
}

export { publicClient, usdcContract, operatorAddress, operatorPrivateKey };
