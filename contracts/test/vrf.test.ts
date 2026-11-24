import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEventLogs, type Hex } from 'viem';
import {
  actualSeed,
  expandRandomWords,
  generateProof,
  proofToAbi,
  verifyProof,
} from '../../backend/src/chain/vrfProof.js';
import { expectRevert, gameId, KEY_HASH, ORACLE_PK, ORACLE_SK, setup } from './helpers.js';

describe('AkipolyVRF: request → proof → on-chain verification → ball', () => {
  it('fulfills a request with a valid proof and records the ball on-chain', async () => {
    const t = await setup();
    const req = await t.requestBall(gameId(1), 1);
    const { proof, output, alpha } = await t.prove(req);

    // The off-chain verifier and the on-chain verifier agree.
    assert.equal(verifyProof({ ...proof, pk: proof.pk, gamma: proof.gamma } as never, alpha), output);

    const receipt = await t.fulfill(proof, req.rc);
    const [fulfilled] = parseEventLogs({
      abi: t.abis.coordAbi,
      logs: receipt.logs,
      eventName: 'RandomWordsFulfilled',
    }) as unknown as { args: { requestId: bigint; outputSeed: bigint; success: boolean } }[];
    assert.equal(fulfilled!.args.requestId, req.requestId);
    assert.equal(fulfilled!.args.outputSeed, output, 'on-chain VRF output == off-chain output');
    assert.equal(fulfilled!.args.success, true);

    const [drawn] = parseEventLogs({ abi: t.abis.roundsAbi, logs: receipt.logs, eventName: 'BallDrawn' }) as unknown as {
      args: { gameId: Hex; round: number; randomWord: bigint; ball: number };
    }[];
    const [word] = expandRandomWords(output, 1);
    assert.equal(drawn!.args.randomWord, word);
    assert.equal(drawn!.args.ball, Number(word! % 17n));

    const [ok, ball] = (await t.pub.readContract({
      address: t.addresses.rounds,
      abi: t.abis.roundsAbi,
      functionName: 'ballOf',
      args: [gameId(1), 1],
    })) as [boolean, number];
    assert.equal(ok, true);
    assert.equal(ball, drawn!.args.ball);
    assert.ok(ball >= 0 && ball <= 16);

    assert.equal(
      await t.pub.readContract({
        address: t.addresses.coordinator,
        abi: t.abis.coordAbi,
        functionName: 'pendingRequestExists',
        args: [req.requestId],
      }),
      false,
    );
  });

  it('derives preSeed and requestId exactly like VRFCoordinatorV2_5', async () => {
    const { keccak256, encodeAbiParameters } = await import('viem');
    const t = await setup();
    const req = await t.requestBall(gameId(2), 0);
    const preSeed = BigInt(
      keccak256(
        encodeAbiParameters(
          [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint64' }],
          [KEY_HASH, t.addresses.rounds, 1n],
        ),
      ),
    );
    assert.equal(req.preSeed, preSeed);
    assert.equal(
      req.requestId,
      BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [KEY_HASH, preSeed]))),
    );
  });

  it('rejects tampered proofs', async () => {
    const t = await setup();
    const req = await t.requestBall(gameId(3), 1);
    const { proof } = await t.prove(req);
    const bump = (v: bigint) => v + 1n;

    // c feeds the first check (u = c*pk + s*G), so a bumped c fails there.
    await expectRevert(t.fulfill({ ...proof, c: bump(proof.c) }, req.rc), 'addr(c*pk+s*g)!=_uWitness');
    await expectRevert(t.fulfill({ ...proof, s: bump(proof.s) }, req.rc), 'addr(c*pk+s*g)!=_uWitness');
    await expectRevert(t.fulfill({ ...proof, gamma: [proof.gamma[0], bump(proof.gamma[1])] }, req.rc), 'gamma is not on curve');
    await expectRevert(t.fulfill({ ...proof, zInv: bump(proof.zInv) }, req.rc), 'invZ must be inverse of z');
    await expectRevert(
      t.fulfill({ ...proof, uWitness: '0x000000000000000000000000000000000000dEaD' }, req.rc),
      'addr(c*pk+s*g)!=_uWitness',
    );
    // A valid-looking proof for a different gamma (another key's output) fails too.
    const other = generateProof(0xbadbadn, req.preSeed, 1n).proof;
    await expectRevert(t.fulfill({ ...proof, gamma: other.gamma }, req.rc), 'First mul check failed');
  });

  it('rejects a proof over the wrong input (e.g. a different block hash)', async () => {
    const t = await setup();
    const req = await t.requestBall(gameId(4), 1);
    await t.test.mine({ blocks: 1 });
    // Prove over the block BEFORE the request: a real hash, but not the one committed to.
    const parent = await t.pub.getBlock({ blockNumber: req.rc.blockNum - 1n });
    const wrongAlpha = actualSeed(req.preSeed, parent.hash!);
    const { proof } = generateProof(ORACLE_SK, req.preSeed, wrongAlpha);
    // The contract hashes the committed input to a different curve point H, so the
    // prover's s*H witness no longer matches.
    await expectRevert(t.fulfill(proofToAbi(proof), req.rc), 'Second mul check failed');
  });

  it('rejects a proof from an unregistered key', async () => {
    const t = await setup();
    const req = await t.requestBall(gameId(5), 1);
    const { proof } = await t.prove(req, 0xabcdefn);
    await expectRevert(t.fulfill(proof, req.rc), 'NoSuchProvingKey');
  });

  it('rejects a wrong request commitment', async () => {
    const t = await setup();
    const req = await t.requestBall(gameId(6), 1);
    const { proof } = await t.prove(req);
    await expectRevert(t.fulfill(proof, { ...req.rc, blockNum: req.rc.blockNum - 1n }), 'IncorrectCommitment');
    await expectRevert(t.fulfill(proof, { ...req.rc, numWords: 2 }), 'IncorrectCommitment');
  });

  it('cannot fulfill twice', async () => {
    const t = await setup();
    const req = await t.requestBall(gameId(7), 1);
    const { proof } = await t.prove(req);
    await t.fulfill(proof, req.rc);
    await expectRevert(t.fulfill(proof, req.rc), 'NoCorrespondingRequest');
  });

  it('only the treasury can request, and each round only once', async () => {
    const t = await setup();
    await expectRevert(t.requestBall(gameId(8), 1, t.accounts.stranger), 'OnlyRequester');
    await t.requestBall(gameId(8), 1);
    await expectRevert(t.requestBall(gameId(8), 1), 'AlreadyRequested');
    // A different round of the same game is fine.
    await t.requestBall(gameId(8), 2);
  });

  it('only allowlisted consumers can call the coordinator directly', async () => {
    const t = await setup();
    await expectRevert(
      t.send(t.accounts.stranger, t.addresses.coordinator, t.abis.coordAbi, 'requestRandomWords', [KEY_HASH, 1, 100000, 1]),
      'InvalidConsumer',
    );
  });

  it('only the coordinator can deliver words to the consumer', async () => {
    const t = await setup();
    await expectRevert(
      t.send(t.accounts.stranger, t.addresses.rounds, t.abis.roundsAbi, 'rawFulfillRandomWords', [1n, [7n]]),
      'OnlyCoordinatorCanFulfill',
    );
  });

  it('a failing consumer callback does not undo the fulfillment', async () => {
    // 1000 gas is far too little for the callback's storage writes.
    const t = await setup({ callbackGasLimit: 1000 });
    const req = await t.requestBall(gameId(9), 1);
    const { proof } = await t.prove(req);
    const receipt = await t.fulfill(proof, req.rc);
    const [ev] = parseEventLogs({ abi: t.abis.coordAbi, logs: receipt.logs, eventName: 'RandomWordsFulfilled' }) as unknown as {
      args: { success: boolean };
    }[];
    assert.equal(ev!.args.success, false);
    await expectRevert(t.fulfill(proof, req.rc), 'NoCorrespondingRequest');
  });

  it('fulfills after 256 blocks through the BlockhashStore, never by re-requesting', async () => {
    const t = await setup();
    const req = await t.requestBall(gameId(10), 1);
    const { proof } = await t.prove(req);
    await t.send(t.accounts.fulfiller, t.addresses.store, t.abis.storeAbi, 'store', [req.rc.blockNum]);
    await t.test.mine({ blocks: 300 });
    await t.fulfill(proof, req.rc);

    // Without a stored hash, an old request cannot be fulfilled (but stays pending).
    const late = await t.requestBall(gameId(10), 2);
    const lateProof = await t.prove(late);
    await t.test.mine({ blocks: 300 });
    await expectRevert(t.fulfill(lateProof.proof, late.rc), 'BlockhashNotInStore');
  });

  it('balls are spread over 0..16', async () => {
    const t = await setup();
    const seen = new Set<number>();
    for (let r = 1; r <= 25; r++) {
      const req = await t.requestBall(gameId(11), r);
      const { proof, output } = await t.prove(req);
      await t.fulfill(proof, req.rc);
      const ball = Number(expandRandomWords(output, 1)[0]! % 17n);
      seen.add(ball);
    }
    assert.ok(seen.size >= 8, `expected a spread of balls, saw ${[...seen].join(',')}`);
  });

  it('keyHash matches the registered public key', async () => {
    const t = await setup();
    assert.equal(
      await t.pub.readContract({
        address: t.addresses.coordinator,
        abi: t.abis.coordAbi,
        functionName: 'hashOfKey',
        args: [ORACLE_PK],
      }),
      KEY_HASH,
    );
  });
});
