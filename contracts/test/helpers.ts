/**
 * Test harness: an in-process Ganache EVM (pure JS, no native binaries) driven
 * by viem, with the contracts compiled by scripts/build.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { mnemonicToAccount } from 'viem/accounts';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  custom,
  defineChain,
  encodeErrorResult,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import {
  actualSeed,
  generateProof,
  keyHashOf,
  proofToAbi,
  publicKeyOf,
} from '../../backend/src/chain/vrfProof.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function artifact(name: string): { abi: Abi; bytecode: Hex } {
  return JSON.parse(readFileSync(join(root, 'artifacts', `${name}.json`), 'utf8'));
}

const MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect';
const CHAIN = defineChain({
  id: 1337,
  name: 'ganache',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost'] } },
});

const ERROR_STRING_ABI = [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }] as const;

export const ORACLE_SK = 0x5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1edn;
export const ORACLE_PK = publicKeyOf(ORACLE_SK);
export const KEY_HASH = keyHashOf(ORACLE_PK);

export async function setup(opts: { callbackGasLimit?: number } = {}) {
  const provider = ganache.provider({
    logging: { quiet: true },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 4 },
    chain: { hardfork: 'shanghai', vmErrorsOnRPCResponse: false, chainId: CHAIN.id },
    miner: { instamine: 'eager' },
  });
  // Ganache nests revert data as error.data.result; viem expects error.data to be the hex.
  const transport = custom({
    async request(args: { method: string; params?: unknown }) {
      try {
        return await provider.request(args as never);
      } catch (err) {
        // Ganache reports reverts as: VM Exception while processing transaction: revert <hex | "reason">
        // Custom errors come back as error.data (hex string); reason strings only in the message.
        const raw = (err as { data?: unknown }).data;
        if (typeof raw === 'string' && /^0x[0-9a-fA-F]+$/.test(raw)) {
          throw Object.assign(new Error('execution reverted'), { code: 3, data: raw });
        }
        const m = /revert\s*"?([^"]*)"?\s*$/.exec((err as Error).message ?? '');
        if (!m) throw err;
        const payload = m[1]!.trim();
        const data = /^0x[0-9a-fA-F]*$/.test(payload)
          ? payload
          : encodeErrorResult({ abi: ERROR_STRING_ABI, errorName: 'Error', args: [payload] });
        throw Object.assign(new Error('execution reverted'), { code: 3, data });
      }
    },
  });
  const pub = createPublicClient({ transport, pollingInterval: 10 });
  const test = createTestClient({ mode: 'ganache', transport });
  // Ganache's deterministic mnemonic; sign locally like the backend does.
  const keys = [0, 1, 2, 3].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
  const [owner, treasury, stranger, fulfiller] = keys.map((k) => k.address);
  const byAddress = new Map(keys.map((k) => [k.address, k]));
  const wallet = (account: Address) => createWalletClient({ account: byAddress.get(account)!, transport, chain: CHAIN });

  async function deploy(name: string, args: unknown[] = [], from: Address = owner!): Promise<Address> {
    const a = artifact(name);
    const hash = await wallet(from).deployContract({ abi: a.abi, bytecode: a.bytecode, args, chain: CHAIN });
    const r = await pub.waitForTransactionReceipt({ hash });
    return r.contractAddress!;
  }

  const store = await deploy('BlockhashStore');
  const coordinator = await deploy('AkipolyVRFCoordinator', [store]);
  const rounds = await deploy('AkipolyRounds', [coordinator, treasury, KEY_HASH, 1, opts.callbackGasLimit ?? 200_000]);

  const coordAbi = artifact('AkipolyVRFCoordinator').abi;
  const roundsAbi = artifact('AkipolyRounds').abi;
  const storeAbi = artifact('BlockhashStore').abi;

  async function send(from: Address, address: Address, abi: Abi, functionName: string, args: unknown[] = []) {
    // Simulate first so reverts surface as decoded errors.
    const account = byAddress.get(from)!;
    // (simulate with the bare address: Ganache rejects some fields viem adds for local accounts)
    const { request } = await pub.simulateContract({ account: from, address, abi, functionName, args });
    const hash = await wallet(from).writeContract({ ...request, account, chain: CHAIN } as never);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted`);
    return receipt;
  }

  await send(owner!, coordinator, coordAbi, 'registerProvingKey', [ORACLE_PK]);
  await send(owner!, coordinator, coordAbi, 'addConsumer', [rounds]);

  /** Treasury requests a ball. Returns what the oracle reads from the log. */
  async function requestBall(gameId: Hex, round: number, from: Address = treasury!) {
    const receipt = await send(from, rounds, roundsAbi, 'requestBall', [gameId, round]);
    const [ev] = parseEventLogs({ abi: coordAbi, logs: receipt.logs, eventName: 'RandomWordsRequested' }) as unknown as {
      args: { requestId: bigint; preSeed: bigint; callbackGasLimit: number; numWords: number; sender: Address };
    }[];
    return {
      receipt,
      requestId: ev!.args.requestId,
      preSeed: ev!.args.preSeed,
      rc: {
        blockNum: receipt.blockNumber,
        callbackGasLimit: ev!.args.callbackGasLimit,
        numWords: ev!.args.numWords,
        sender: ev!.args.sender,
      },
    };
  }

  /** What the oracle node does: read the block hash, prove, return the call args. */
  async function prove(req: Awaited<ReturnType<typeof requestBall>>, sk = ORACLE_SK) {
    // Wait for requestConfirmations (1): blockhash(n) is only readable from block n+1 on.
    await test.mine({ blocks: 1 });
    const block = await pub.getBlock({ blockNumber: req.rc.blockNum });
    const alpha = actualSeed(req.preSeed, block.hash!);
    const { proof, output } = generateProof(sk, req.preSeed, alpha);
    return { proof: proofToAbi(proof), output, alpha };
  }

  async function fulfill(proof: ReturnType<typeof proofToAbi>, rc: Awaited<ReturnType<typeof requestBall>>['rc']) {
    return send(fulfiller!, coordinator, coordAbi, 'fulfillRandomWords', [proof, rc]);
  }

  return {
    provider,
    pub,
    test,
    accounts: { owner: owner!, treasury: treasury!, stranger: stranger!, fulfiller: fulfiller! },
    addresses: { store, coordinator, rounds },
    abis: { coordAbi, roundsAbi, storeAbi },
    send,
    requestBall,
    prove,
    fulfill,
  };
}

/** Assert that a call reverts with a given custom error name or reason string. */
export async function expectRevert(p: Promise<unknown>, expected: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    const msg = err instanceof BaseError ? err.message : String(err);
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) {
        const got = revert.data?.errorName === 'Error' ? String(revert.data.args?.[0]) : revert.data?.errorName;
        if (got === expected || revert.reason === expected) return;
        throw new Error(`expected revert "${expected}", got "${got ?? revert.reason}"`);
      }
    }
    if (msg.includes(expected)) return;
    throw new Error(`expected revert "${expected}", got: ${msg.slice(0, 300)}`);
  }
  throw new Error(`expected revert "${expected}", but call succeeded`);
}

export const gameId = (n: number): Hex => `0x${n.toString(16).padStart(32, '0')}`;
