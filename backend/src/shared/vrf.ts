/**
 * VRF pieces shared by the backend and the web client. Dependency-free (no
 * viem import) so the frontend can use it too: pass the ABI strings to
 * viem's parseAbi.
 *
 * The ball is decided on-chain by AkipolyRounds:
 *     ball = BALL_MIN + randomWord % 17
 * where randomWord = keccak256(abi.encode(vrfOutput, 0)) and vrfOutput is
 * proven by the coordinator's on-chain VRF verifier.
 */
import { BALL_MAX, BALL_MIN } from './constants.js';

export const BALL_RANGE = BigInt(BALL_MAX - BALL_MIN + 1);

/** Same arithmetic as AkipolyRounds.fulfillRandomWords. */
export function ballFromRandomWord(randomWord: bigint): number {
  return BALL_MIN + Number(randomWord % BALL_RANGE);
}

/** A game's uuid as the bytes16 the contract keys rounds by. */
export function gameIdToBytes16(gameId: string): `0x${string}` {
  const hex = gameId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`not a uuid: ${gameId}`);
  return `0x${hex}`;
}

/** Human-readable ABI of AkipolyRounds (the part the game uses). */
export const AKIPOLY_ROUNDS_ABI = [
  'struct Draw { uint256 requestId; uint256 randomWord; uint64 requestedAt; bool fulfilled; uint8 ball; }',
  'function requestBall(bytes16 gameId, uint32 round) returns (uint256 requestId)',
  'function drawOf(bytes16 gameId, uint32 round) view returns (Draw)',
  'function ballOf(bytes16 gameId, uint32 round) view returns (bool fulfilled, uint8 ball)',
  'function requester() view returns (address)',
  'function keyHash() view returns (bytes32)',
  'function requestConfirmations() view returns (uint16)',
  'function COORDINATOR() view returns (address)',
  'event BallRequested(bytes16 indexed gameId, uint32 indexed round, uint256 requestId)',
  'event BallDrawn(bytes16 indexed gameId, uint32 indexed round, uint256 requestId, uint256 randomWord, uint8 ball)',
] as const;

/** Human-readable ABI of AkipolyVRFCoordinator (the part the oracle uses). */
export const VRF_COORDINATOR_ABI = [
  'struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }',
  'struct RequestCommitment { uint64 blockNum; uint32 callbackGasLimit; uint32 numWords; address sender; }',
  'function fulfillRandomWords(Proof proof, RequestCommitment rc) returns (uint256 outputSeed)',
  'function hashOfKey(uint256[2] publicKey) pure returns (bytes32)',
  'function s_provingKeys(bytes32 keyHash) view returns (bool)',
  'function s_consumers(address consumer) view returns (bool)',
  'function pendingRequestExists(uint256 requestId) view returns (bool)',
  'function BLOCKHASH_STORE() view returns (address)',
  'event RandomWordsRequested(bytes32 indexed keyHash, uint256 requestId, uint256 preSeed, uint16 minimumRequestConfirmations, uint32 callbackGasLimit, uint32 numWords, address indexed sender)',
  'event RandomWordsFulfilled(uint256 indexed requestId, uint256 outputSeed, bool success)',
] as const;

export const BLOCKHASH_STORE_ABI = [
  'function store(uint256 n)',
  'function getBlockhash(uint256 n) view returns (bytes32)',
] as const;
