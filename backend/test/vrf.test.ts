// The off-chain VRF prover (src/chain/vrfProof.ts) must stay byte-for-byte
// compatible with contracts/src/vrf/VRF.sol. contracts/test/vrf.test.ts proves
// that against a real EVM; this pins it with a known-answer vector so any
// change to the prover's output is caught here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualSeed,
  expandRandomWords,
  generateProof,
  keyHashOf,
  publicKeyOf,
  verifyProof,
  type VrfProof,
} from '../src/chain/vrfProof.ts';
import { ballFromRandomWord, gameIdToBytes16 } from '../src/domain/fairness.ts';

const SK = 0x5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1ed5ea1edn;
const PRE_SEED = 12345678901234567890n;
const BLOCK_HASH = '0x9c7fecfe7395c06a727d8de802f4bc025b428424b60c5f03c8ffca7e728bf693';

test('known-answer vector (accepted by the on-chain verifier)', () => {
  const pk = publicKeyOf(SK);
  assert.deepEqual(pk, [
    0x7ba3ce61433fadc755d06f6843f2fd9a09a56c4f89ed72775fe281e030b5a93en,
    0x4123ebab94eb21559d3134b011894db434a195d60c66147d4373702b3ac106ffn,
  ]);
  assert.equal(keyHashOf(pk), '0x9a12fb80961e812ffcad80c55f130a1cffe6ffbe7d72a3497c547db2a362fafa');

  const alpha = actualSeed(PRE_SEED, BLOCK_HASH);
  assert.equal(alpha, 0x6bf30dca7f7fa00fa2b23c67e253be276e96e6e6ac4c6778b21b171a54d57f6cn);

  const { proof, output } = generateProof(SK, PRE_SEED, alpha);
  assert.deepEqual(proof.gamma, [
    0x261a1233a1a85eac0ced6f0f6231bca10bad03ffb7b311d3142be5facd297013n,
    0xfcc12d42935721e761ee2f483be84adca9828dd36aa2dc690a75976790bc4475n,
  ]);
  assert.equal(proof.c, 0x6ba3666904b35192b513b838f9d4948037ab86a198a265d099155598c1bd52fan);
  assert.equal(proof.s, 0x76345b2c01d3230270f992ece7ae4ccdaa8d59e63f0b89e70cf064764c105883n);
  assert.equal(proof.uWitness, '0xc1c0b36af1d785f9C3316E719661c20E5034A713');
  assert.equal(proof.seed, PRE_SEED);
  assert.equal(output, 0xfc6ab5c8e3e377b6d85717e55e76b63ac1b07ba7a84b2596c306381437303df4n);
  assert.deepEqual(expandRandomWords(output, 1), [
    0xa10623c17ba98af04b6a9b8db4a398c15a062c49ea529612efc23779748b0c7dn,
  ]);
});

test('proofs verify, and the output depends only on key + input', () => {
  for (let i = 1n; i <= 10n; i++) {
    const alpha = actualSeed(i, BLOCK_HASH);
    const a = generateProof(SK, i, alpha);
    assert.equal(verifyProof(a.proof, alpha), a.output);
    // Uniqueness: Gamma (hence the output) is fixed by sk and alpha.
    assert.equal(generateProof(SK, i + 1000n, alpha).output, a.output);
  }
});

test('tampered or mismatched proofs are rejected', () => {
  const alpha = actualSeed(PRE_SEED, BLOCK_HASH);
  const { proof } = generateProof(SK, PRE_SEED, alpha);
  const bad = (p: Partial<VrfProof>) => () => verifyProof({ ...proof, ...p }, alpha);
  assert.throws(bad({ c: proof.c + 1n }));
  assert.throws(bad({ s: proof.s + 1n }));
  assert.throws(bad({ gamma: [proof.gamma[0], proof.gamma[1] + 1n] }));
  assert.throws(bad({ zInv: proof.zInv + 1n }));
  assert.throws(bad({ uWitness: '0x000000000000000000000000000000000000dEaD' }));
  assert.throws(() => verifyProof(proof, alpha + 1n), 'a different block hash is a different input');
  const other = generateProof(0xabcdefn, PRE_SEED, alpha).proof;
  assert.throws(bad({ pk: other.pk }), 'another key cannot claim this proof');
});

test('ball = randomWord % 17, always in 0..16', () => {
  assert.equal(ballFromRandomWord(0n), 0);
  assert.equal(ballFromRandomWord(16n), 16);
  assert.equal(ballFromRandomWord(17n), 0);
  assert.equal(ballFromRandomWord(0xa10623c17ba98af04b6a9b8db4a398c15a062c49ea529612efc23779748b0c7dn), Number(0xa10623c17ba98af04b6a9b8db4a398c15a062c49ea529612efc23779748b0c7dn % 17n));
  const counts = new Array(17).fill(0);
  for (let i = 0n; i < 1700n; i++) counts[ballFromRandomWord(expandRandomWords(i, 1)[0]!)] += 1;
  assert.ok(counts.every((n) => n > 50), `roughly uniform: ${counts.join(',')}`);
});

test('game ids map to the bytes16 the contract keys rounds by', () => {
  assert.equal(gameIdToBytes16('0f8fad5b-d9cb-469f-a165-70867728950e'), '0x0f8fad5bd9cb469fa16570867728950e');
  assert.throws(() => gameIdToBytes16('game-1'));
});
