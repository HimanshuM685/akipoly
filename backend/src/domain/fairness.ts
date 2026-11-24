/**
 * Provably fair ball, via Akipoly's on-chain VRF (modelled on Chainlink VRF v2.5).
 *
 * When betting closes, the treasury calls AkipolyRounds.requestBall(game, round).
 * The coordinator derives the VRF input from on-chain data only:
 *   preSeed = keccak256(keyHash, consumer, nonce)
 *   alpha   = keccak256(preSeed, blockhash(requestBlock))
 * The oracle proves Gamma = sk * hashToCurve(pk, alpha). The coordinator verifies
 * the proof on-chain and passes keccak256(Gamma) on as random words, and
 * AkipolyRounds computes the ball itself. The server never chooses or holds a
 * random value. It relays the proof and reads the result back.
 */
export { BALL_RANGE, ballFromRandomWord, gameIdToBytes16 } from '../shared/vrf.js';
