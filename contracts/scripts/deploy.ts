/**
 * Deploy Akipoly's VRF to Arc (or any EVM RPC):
 *   BlockhashStore → AkipolyVRFCoordinator → AkipolyRounds,
 *   then register the oracle key and allowlist AkipolyRounds as a consumer.
 *
 *   DEPLOYER_PRIVATE_KEY=0x… RPC_URL=https://rpc.testnet.arc.io \
 *   TREASURY_ADDRESS=0x… VRF_ORACLE_KEY=0x… npm run deploy
 *
 * Optional: REQUEST_CONFIRMATIONS (default 1), CALLBACK_GAS_LIMIT (default 200000).
 * The oracle key never leaves this machine: only its public key goes on-chain.
 * Prints the env lines for backend/.env.
 */
import { createPublicClient, createWalletClient, defineChain, getAddress, http, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { keyHashOf, publicKeyOf } from '../../backend/src/chain/vrfProof.js';
import { artifact } from '../test/helpers.js';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`set ${name}`);
  return v;
}

const rpcUrl = need('RPC_URL');
const deployer = privateKeyToAccount(need('DEPLOYER_PRIVATE_KEY') as Hex);
const treasury = getAddress(need('TREASURY_ADDRESS'));
const oraclePk = publicKeyOf(BigInt(need('VRF_ORACLE_KEY')));
const keyHash = keyHashOf(oraclePk);
const confirmations = Number(process.env.REQUEST_CONFIRMATIONS ?? 1);
const callbackGasLimit = Number(process.env.CALLBACK_GAS_LIMIT ?? 200_000);

const probe = createPublicClient({ transport: http(rpcUrl) });
const chain = defineChain({
  id: await probe.getChainId(),
  name: 'target',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const pub = createPublicClient({ chain, transport: http(rpcUrl) });
const wallet = createWalletClient({ chain, transport: http(rpcUrl), account: deployer });

async function deploy(name: string, args: unknown[] = []) {
  const a = artifact(name);
  const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`${name} deploy failed (${hash})`);
  console.log(`${name}: ${r.contractAddress}`);
  return r.contractAddress;
}

async function call(address: Hex, abi: Abi, functionName: string, args: unknown[]) {
  const { request } = await pub.simulateContract({ account: deployer, address, abi, functionName, args });
  const hash = await wallet.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${functionName} failed (${hash})`);
}

console.log(`chain ${chain.id}, deployer ${deployer.address}, treasury ${treasury}`);
const store = await deploy('BlockhashStore');
const coordinator = await deploy('AkipolyVRFCoordinator', [store]);
const rounds = await deploy('AkipolyRounds', [coordinator, treasury, keyHash, confirmations, callbackGasLimit]);
const coordAbi = artifact('AkipolyVRFCoordinator').abi;
await call(coordinator, coordAbi, 'setConfig', [confirmations, 2_500_000]);
await call(coordinator, coordAbi, 'registerProvingKey', [oraclePk]);
await call(coordinator, coordAbi, 'addConsumer', [rounds]);

console.log(`\n# backend/.env
VRF_ROUNDS_ADDRESS=${rounds}
VRF_COORDINATOR_ADDRESS=${coordinator}
# VRF_ORACLE_KEY=<the key you passed in> (keyHash ${keyHash})`);
