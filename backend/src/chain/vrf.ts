/**
 * Akipoly VRF on Arc: the treasury's calls to AkipolyRounds and the oracle side
 * of the coordinator (the job a Chainlink VRF node does).
 */
import {
  BaseError,
  HttpRequestError,
  RpcRequestError,
  TimeoutError,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { env } from '../config/env.js';
import { AKIPOLY_ROUNDS_ABI, BLOCKHASH_STORE_ABI, VRF_COORDINATOR_ABI, gameIdToBytes16 } from '../shared/vrf.js';
import { publicClient, signTreasuryTx, treasuryAddress } from './usdc.js';
import {
  actualSeed,
  generateProof,
  keyHashOf,
  proofToAbi,
  publicKeyOf,
  verifyProof,
} from './vrfProof.js';

export const roundsAbi = parseAbi(AKIPOLY_ROUNDS_ABI);
export const coordinatorAbi = parseAbi(VRF_COORDINATOR_ABI);
const storeAbi = parseAbi(BLOCKHASH_STORE_ABI);

export const roundsAddress: Address = getAddress(env.VRF_ROUNDS_ADDRESS);
export const coordinatorAddress: Address = getAddress(env.VRF_COORDINATOR_ADDRESS);

const oracleSecret = BigInt(env.VRF_ORACLE_KEY);
export const oraclePublicKey = publicKeyOf(oracleSecret);
export const oracleKeyHash: Hex = keyHashOf(oraclePublicKey);

/** The coordinator data needed to fulfill a request, read from its RandomWordsRequested log. */
export interface VrfRequest {
  requestId: bigint;
  preSeed: bigint;
  blockNumber: bigint;
  minConfirmations: number;
  callbackGasLimit: number;
  numWords: number;
  sender: Address;
}

export interface VrfFulfillment {
  success: boolean;
  outputSeed: bigint;
  /** null if the consumer callback failed */
  ball: number | null;
  randomWord: bigint | null;
}

export function signRequestBall(gameId: string, roundNumber: number): Promise<{ raw: Hex; hash: Hash }> {
  return signTreasuryTx(
    roundsAddress,
    encodeFunctionData({ abi: roundsAbi, functionName: 'requestBall', args: [gameIdToBytes16(gameId), roundNumber] }),
  );
}

export function parseRequest(receipt: TransactionReceipt): VrfRequest | null {
  const ev = parseEventLogs({ abi: coordinatorAbi, eventName: 'RandomWordsRequested', logs: receipt.logs }).find(
    (l) => getAddress(l.address) === coordinatorAddress && getAddress(l.args.sender) === roundsAddress,
  );
  if (!ev) return null;
  return {
    requestId: ev.args.requestId,
    preSeed: ev.args.preSeed,
    blockNumber: receipt.blockNumber,
    minConfirmations: ev.args.minimumRequestConfirmations,
    callbackGasLimit: ev.args.callbackGasLimit,
    numWords: ev.args.numWords,
    sender: getAddress(ev.args.sender),
  };
}

/**
 * The oracle step: read the request block's hash, prove the VRF over
 * keccak256(preSeed, blockHash), check the proof locally, and sign the
 * fulfillment. Call only once the request has its confirmations (blockhash
 * of block n is only readable from block n+1).
 */
export async function signFulfill(req: VrfRequest): Promise<{ raw: Hex; hash: Hash; output: bigint }> {
  const block = await publicClient.getBlock({ blockNumber: req.blockNumber });
  if (!block.hash) throw new Error(`no hash for block ${req.blockNumber}`);
  const alpha = actualSeed(req.preSeed, block.hash);
  const { proof, output } = generateProof(oracleSecret, req.preSeed, alpha);
  if (verifyProof(proof, alpha) !== output) throw new Error('VRF self-check failed');
  const { raw, hash } = await signTreasuryTx(
    coordinatorAddress,
    encodeFunctionData({
      abi: coordinatorAbi,
      functionName: 'fulfillRandomWords',
      args: [
        proofToAbi(proof),
        {
          blockNum: req.blockNumber,
          callbackGasLimit: req.callbackGasLimit,
          numWords: req.numWords,
          sender: req.sender,
        },
      ],
    }),
  );
  return { raw, hash, output };
}

/** Save a block hash to the BlockhashStore before it leaves the 256-block window. */
export async function signStoreBlockhash(storeAddress: Address, blockNumber: bigint) {
  return signTreasuryTx(storeAddress, encodeFunctionData({ abi: storeAbi, functionName: 'store', args: [blockNumber] }));
}

/** The stored hash, or null if the store doesn't have it (getBlockhash reverts). */
export async function readStoredBlockhash(storeAddress: Address, blockNumber: bigint): Promise<Hex | null> {
  return publicClient
    .readContract({ address: storeAddress, abi: storeAbi, functionName: 'getBlockhash', args: [blockNumber] })
    .catch(() => null);
}

export function parseFulfillment(receipt: TransactionReceipt, requestId: bigint): VrfFulfillment | null {
  const fulfilled = parseEventLogs({ abi: coordinatorAbi, eventName: 'RandomWordsFulfilled', logs: receipt.logs }).find(
    (l) => getAddress(l.address) === coordinatorAddress && l.args.requestId === requestId,
  );
  if (!fulfilled) return null;
  const drawn = parseEventLogs({ abi: roundsAbi, eventName: 'BallDrawn', logs: receipt.logs }).find(
    (l) => getAddress(l.address) === roundsAddress && l.args.requestId === requestId,
  );
  return {
    success: fulfilled.args.success,
    outputSeed: fulfilled.args.outputSeed,
    ball: drawn ? drawn.args.ball : null,
    randomWord: drawn ? drawn.args.randomWord : null,
  };
}

/** The on-chain record of a round's draw, read straight from AkipolyRounds. */
export async function readDraw(gameId: string, roundNumber: number) {
  return publicClient.readContract({
    address: roundsAddress,
    abi: roundsAbi,
    functionName: 'drawOf',
    args: [gameIdToBytes16(gameId), roundNumber],
  });
}

/**
 * Refuse to run a treasury worker against a mis-wired deployment: wrong
 * requester, coordinator, key or consumer allowlist would strand every round
 * in 'drawing'.
 */
export async function checkVrfSetup(): Promise<{ mismatches: string[]; unreachable: string | null }> {
  const problems: string[] = [];
  let unreachable: string | null = null;
  // Transport failures (RPC down, timeout) are retryable; anything else (no
  // contract at the address, wrong ABI) means the deployment is wrong.
  const isTransport = (err: unknown) =>
    err instanceof BaseError &&
    !!err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError || e instanceof RpcRequestError);
  const read = <T>(p: Promise<T>) =>
    p.catch((err: unknown) => {
      if (isTransport(err)) unreachable ??= String(err);
      else problems.push(String(err));
      return null;
    });
  const [requester, coordinator, keyHash, registered, isConsumer] = await Promise.all([
    read(publicClient.readContract({ address: roundsAddress, abi: roundsAbi, functionName: 'requester' })),
    read(publicClient.readContract({ address: roundsAddress, abi: roundsAbi, functionName: 'COORDINATOR' })),
    read(publicClient.readContract({ address: roundsAddress, abi: roundsAbi, functionName: 'keyHash' })),
    read(
      publicClient.readContract({
        address: coordinatorAddress,
        abi: coordinatorAbi,
        functionName: 's_provingKeys',
        args: [oracleKeyHash],
      }),
    ),
    read(
      publicClient.readContract({
        address: coordinatorAddress,
        abi: coordinatorAbi,
        functionName: 's_consumers',
        args: [roundsAddress],
      }),
    ),
  ]);
  if (problems.length || unreachable) return { mismatches: problems, unreachable };
  if (getAddress(requester!) !== treasuryAddress) problems.push(`AkipolyRounds.requester is ${requester}, not the treasury ${treasuryAddress}`);
  if (getAddress(coordinator!) !== coordinatorAddress) problems.push(`AkipolyRounds.COORDINATOR is ${coordinator}, env says ${coordinatorAddress}`);
  if (keyHash !== oracleKeyHash) problems.push(`AkipolyRounds.keyHash ${keyHash} does not match VRF_ORACLE_KEY (${oracleKeyHash})`);
  if (!registered) problems.push(`VRF_ORACLE_KEY's public key is not registered on the coordinator`);
  if (!isConsumer) problems.push(`AkipolyRounds is not an allowlisted consumer of the coordinator`);
  return { mismatches: problems, unreachable: null };
}
