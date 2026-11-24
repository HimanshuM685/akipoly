/**
 * Off-chain prover for Akipoly's VRF. It mirrors contracts/src/vrf/VRF.sol, which
 * is Chainlink's verifier, and produces the same proofs as Chainlink's Go node
 * (core/services/vrf/proof).
 *
 * Pure crypto: no env, no network, so the contract tests can import it.
 *
 *   H     = hashToCurve(pk, alpha)          try-and-increment with keccak256
 *   Gamma = sk * H                          the VRF point
 *   output = keccak256(abi.encode(3, Gamma))
 *   proof: k random-looking nonce, u = k*G, v = k*H,
 *          c = keccak256(2, H, pk, Gamma, v, address(u)),  s = k - c*sk  (mod n)
 *   + witnesses c*Gamma, s*H and zInv so the EVM can check them via ecrecover.
 *
 * alpha is never chosen by us. The coordinator defines it as
 * keccak256(preSeed, blockhash(requestBlock)), from the request event and the
 * block it landed in.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { concat, getAddress, keccak256, numberToHex, type Address, type Hex } from 'viem';

export const FIELD_SIZE = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const GROUP_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

const HASH_TO_CURVE_HASH_PREFIX = 1n;
const SCALAR_FROM_CURVE_POINTS_HASH_PREFIX = 2n;
const VRF_RANDOM_OUTPUT_HASH_PREFIX = 3n;
const SQRT_POWER = (FIELD_SIZE + 1n) >> 2n;

const Point = secp256k1.ProjectivePoint;
type AffinePoint = readonly [bigint, bigint];

export interface VrfProof {
  pk: readonly [bigint, bigint];
  gamma: readonly [bigint, bigint];
  c: bigint;
  s: bigint;
  /** The request's preSeed. The coordinator mixes in the block hash itself. */
  seed: bigint;
  uWitness: Address;
  cGammaWitness: readonly [bigint, bigint];
  sHashWitness: readonly [bigint, bigint];
  zInv: bigint;
}

// ---------------------------------------------------------------- helpers
const mod = (a: bigint, m: bigint) => ((a % m) + m) % m;
const word = (v: bigint): Hex => numberToHex(v, { size: 32 });
const hashToInt = (data: Hex) => BigInt(keccak256(data));

function powMod(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

const invMod = (a: bigint, m: bigint) => powMod(a, m - 2n, m); // m is prime

function ySquared(x: bigint): bigint {
  return mod(x * x * x + 7n, FIELD_SIZE);
}

export function isOnCurve(p: AffinePoint): boolean {
  if (p[0] >= FIELD_SIZE || p[1] >= FIELD_SIZE) return false;
  return ySquared(p[0]) === mod(p[1] * p[1], FIELD_SIZE);
}

function fieldHash(b: Hex): bigint {
  let x = hashToInt(b);
  while (x >= FIELD_SIZE) x = hashToInt(word(x));
  return x;
}

function newCandidatePoint(b: Hex): AffinePoint {
  const x = fieldHash(b);
  let y = powMod(ySquared(x), SQRT_POWER, FIELD_SIZE);
  if (y % 2n === 1n) y = FIELD_SIZE - y;
  return [x, y];
}

/** VRF.sol `_hashToCurve`. Packed encoding: prefix ‖ pk.x ‖ pk.y ‖ input, 32 bytes each. */
export function hashToCurve(pk: AffinePoint, input: bigint): AffinePoint {
  let rv = newCandidatePoint(concat([word(HASH_TO_CURVE_HASH_PREFIX), word(pk[0]), word(pk[1]), word(input)]));
  while (!isOnCurve(rv)) rv = newCandidatePoint(word(rv[0]));
  return rv;
}

function toAffine(p: InstanceType<typeof Point>): AffinePoint {
  const a = p.toAffine();
  return [a.x, a.y];
}

const fromAffine = (p: AffinePoint) => Point.fromAffine({ x: p[0], y: p[1] });

/** Ethereum address of a curve point: the low 20 bytes of keccak256(x ‖ y). */
export function pointAddress(p: AffinePoint): Address {
  return getAddress(`0x${keccak256(concat([word(p[0]), word(p[1])])).slice(-40)}`);
}

/** VRF.sol `_scalarFromCurvePoints`. NOT reduced mod n, like the contract. */
export function scalarFromCurvePoints(
  hash: AffinePoint,
  pk: AffinePoint,
  gamma: AffinePoint,
  uWitness: Address,
  v: AffinePoint,
): bigint {
  return hashToInt(
    concat([
      word(SCALAR_FROM_CURVE_POINTS_HASH_PREFIX),
      word(hash[0]),
      word(hash[1]),
      word(pk[0]),
      word(pk[1]),
      word(gamma[0]),
      word(gamma[1]),
      word(v[0]),
      word(v[1]),
      uWitness,
    ]),
  );
}

/** VRF.sol `_projectiveECAdd`, needed to compute the z that zInv must invert. */
export function projectiveECAdd(px: bigint, py: bigint, qx: bigint, qy: bigint): [bigint, bigint, bigint] {
  const F = FIELD_SIZE;
  const sub = (x1: bigint, z1: bigint, x2: bigint, z2: bigint): [bigint, bigint] => [
    mod(z2 * x1 + (F - x2) * z1, F),
    mod(z1 * z2, F),
  ];
  const mul = (x1: bigint, z1: bigint, x2: bigint, z2: bigint): [bigint, bigint] => [mod(x1 * x2, F), mod(z1 * z2, F)];
  const lx = mod(qy + F - py, F);
  const lz = mod(qx + F - px, F);
  let [sx, dx] = mul(lx, lz, lx, lz);
  [sx, dx] = sub(sx, dx, px, 1n);
  [sx, dx] = sub(sx, dx, qx, 1n);
  let [sy, dy] = sub(px, 1n, sx, dx);
  [sy, dy] = mul(sy, dy, lx, lz);
  [sy, dy] = sub(sy, dy, py, 1n);
  if (dx !== dy) return [mod(sx * dy, F), mod(sy * dx, F), mod(dx * dy, F)];
  return [sx, sy, dx];
}

// --------------------------------------------------------------- public API
export function publicKeyOf(secretKey: bigint): [bigint, bigint] {
  if (secretKey <= 0n || secretKey >= GROUP_ORDER) throw new Error('VRF secret key out of range');
  const pk = toAffine(Point.BASE.multiply(secretKey));
  return [pk[0], pk[1]];
}

/** keyHash registered on the coordinator: keccak256(abi.encode(uint256[2] pk)). */
export function keyHashOf(pk: AffinePoint): Hex {
  return keccak256(concat([word(pk[0]), word(pk[1])]));
}

/** The VRF input the coordinator verifies against: keccak256(abi.encodePacked(preSeed, blockHash)). */
export function actualSeed(preSeed: bigint, blockHash: Hex): bigint {
  return hashToInt(concat([word(preSeed), blockHash]));
}

/** The VRF output for a proof's Gamma: keccak256(abi.encode(3, gamma)). */
export function randomnessFromGamma(gamma: AffinePoint): bigint {
  return hashToInt(concat([word(VRF_RANDOM_OUTPUT_HASH_PREFIX), word(gamma[0]), word(gamma[1])]));
}

/** The coordinator's word expansion: keccak256(abi.encode(randomness, i)). */
export function expandRandomWords(randomness: bigint, numWords: number): bigint[] {
  return Array.from({ length: numWords }, (_, i) => hashToInt(concat([word(randomness), word(BigInt(i))])));
}

/**
 * Prove the VRF for `alpha` (the actual seed). `preSeed` goes into proof.seed,
 * because the coordinator recomputes alpha from it plus the block hash.
 *
 * The nonce is derived deterministically from (sk, alpha, counter), as RFC 6979
 * does for ECDSA. Gamma, and so the output, is unique whatever the nonce is.
 */
export function generateProof(secretKey: bigint, preSeed: bigint, alpha: bigint): { proof: VrfProof; output: bigint } {
  const pk = publicKeyOf(secretKey);
  const h = hashToCurve(pk, alpha);
  const H = fromAffine(h);
  const gamma = toAffine(H.multiply(secretKey));

  for (let counter = 0n; counter < 256n; counter++) {
    const nonce = mod(hashToInt(concat([word(secretKey), word(alpha), word(counter)])), GROUP_ORDER);
    if (nonce === 0n) continue;
    const uWitness = pointAddress(toAffine(Point.BASE.multiply(nonce)));
    const v = toAffine(H.multiply(nonce));
    const c = scalarFromCurvePoints(h, pk, gamma, uWitness, v);
    const cRed = mod(c, GROUP_ORDER);
    const s = mod(nonce - cRed * secretKey, GROUP_ORDER);
    // The contract rejects zero scalars and equal witnesses. Both are
    // cryptographically negligible, but retry with a fresh nonce anyway.
    if (cRed === 0n || s === 0n) continue;
    const cGammaWitness = toAffine(fromAffine(gamma).multiply(cRed));
    const sHashWitness = toAffine(H.multiply(s));
    if (cGammaWitness[0] === sHashWitness[0]) continue;
    const [, , z] = projectiveECAdd(cGammaWitness[0], cGammaWitness[1], sHashWitness[0], sHashWitness[1]);
    const zInv = invMod(z, FIELD_SIZE);
    const proof: VrfProof = { pk, gamma, c, s, seed: preSeed, uWitness, cGammaWitness, sHashWitness, zInv };
    return { proof, output: randomnessFromGamma(gamma) };
  }
  throw new Error('could not construct VRF proof');
}

/**
 * Independent check of a proof with plain point arithmetic: the same
 * statements VRF.sol checks with ecrecover. Used by tests and as a self-check
 * before we spend gas on a fulfillment.
 */
export function verifyProof(proof: VrfProof, alpha: bigint): bigint {
  const { pk, gamma, c, s, uWitness, cGammaWitness, sHashWitness, zInv } = proof;
  for (const [name, p] of Object.entries({ pk, gamma, cGammaWitness, sHashWitness })) {
    if (!isOnCurve(p)) throw new Error(`${name} is not on curve`);
  }
  const cRed = mod(c, GROUP_ORDER);
  if (cRed === 0n || mod(s, GROUP_ORDER) === 0n) throw new Error('zero scalar');
  const u = fromAffine(pk).multiply(cRed).add(Point.BASE.multiply(mod(s, GROUP_ORDER)));
  if (pointAddress(toAffine(u)) !== getAddress(uWitness)) throw new Error('addr(c*pk+s*g)!=_uWitness');
  const h = hashToCurve(pk, alpha);
  const cGamma = toAffine(fromAffine(gamma).multiply(cRed));
  const sHash = toAffine(fromAffine(h).multiply(mod(s, GROUP_ORDER)));
  if (cGamma[0] !== cGammaWitness[0] || cGamma[1] !== cGammaWitness[1]) throw new Error('First mul check failed');
  if (sHash[0] !== sHashWitness[0] || sHash[1] !== sHashWitness[1]) throw new Error('Second mul check failed');
  if (cGamma[0] === sHash[0]) throw new Error('points in sum must be distinct');
  const [x, y, z] = projectiveECAdd(cGamma[0], cGamma[1], sHash[0], sHash[1]);
  if (mod(z * zInv, FIELD_SIZE) !== 1n) throw new Error('invZ must be inverse of z');
  const v: AffinePoint = [mod(x * zInv, FIELD_SIZE), mod(y * zInv, FIELD_SIZE)];
  if (scalarFromCurvePoints(h, pk, gamma, uWitness, v) !== c) throw new Error('invalid proof');
  return randomnessFromGamma(gamma);
}

/** Shape viem expects for the Solidity `Proof` struct. */
export function proofToAbi(p: VrfProof) {
  return {
    pk: [p.pk[0], p.pk[1]] as const,
    gamma: [p.gamma[0], p.gamma[1]] as const,
    c: p.c,
    s: p.s,
    seed: p.seed,
    uWitness: p.uWitness,
    cGammaWitness: [p.cGammaWitness[0], p.cGammaWitness[1]] as const,
    sHashWitness: [p.sHashWitness[0], p.sHashWitness[1]] as const,
    zInv: p.zInv,
  };
}
