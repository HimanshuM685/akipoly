/**
 * Runs the backend's real VRF client (backend/src/chain/vrf.ts) against a local
 * Ganache node that impersonates Arc testnet's chain id. This covers the
 * treasury's request, the oracle's proof and fulfillment, log parsing, and the
 * startup wiring check: everything except the Postgres job table.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ganache from 'ganache';
import { parseAbi, toFunctionSelector, toEventSelector, toHex, type Abi, type AbiFunction, type AbiEvent } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { AKIPOLY_ROUNDS_ABI, VRF_COORDINATOR_ABI, BLOCKHASH_STORE_ABI } from '../../backend/src/shared/vrf.js';
import { artifact, ORACLE_SK } from './helpers.js';
import { verifyVrfRound } from '../../src/lib/fairness.js';

const MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect';
const PORT = 18545;
const ARC_TESTNET_CHAIN_ID = 5042002;

describe('shared ABIs match the compiled contracts', () => {
  const check = (human: readonly string[], compiled: Abi) => {
    const sigs = new Set(
      compiled.flatMap((i) =>
        i.type === 'function' ? [toFunctionSelector(i as AbiFunction)] : i.type === 'event' ? [toEventSelector(i as AbiEvent)] : [],
      ),
    );
    for (const item of parseAbi(human)) {
      if (item.type === 'function') assert.ok(sigs.has(toFunctionSelector(item)), `missing function ${item.name}`);
      if (item.type === 'event') assert.ok(sigs.has(toEventSelector(item)), `missing event ${item.name}`);
    }
  };
  it('AkipolyRounds', () => check(AKIPOLY_ROUNDS_ABI, artifact('AkipolyRounds').abi));
  it('AkipolyVRFCoordinator', () => check(VRF_COORDINATOR_ABI, artifact('AkipolyVRFCoordinator').abi));
  it('BlockhashStore', () => check(BLOCKHASH_STORE_ABI, artifact('BlockhashStore').abi));
});

describe('backend oracle client against a live node', () => {
  const server = ganache.server({
    logging: { quiet: true },
    wallet: { mnemonic: MNEMONIC, totalAccounts: 3 },
    chain: { hardfork: 'shanghai', chainId: ARC_TESTNET_CHAIN_ID, vmErrorsOnRPCResponse: false },
    miner: { instamine: 'eager' },
  });
  const deployer = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
  const treasury = mnemonicToAccount(MNEMONIC, { addressIndex: 1 });
  let vrf: typeof import('../../backend/src/chain/vrf.js');
  let usdc: typeof import('../../backend/src/chain/usdc.js');

  before(async () => {
    await server.listen(PORT);
    const rpcUrl = `http://127.0.0.1:${PORT}`;
    // Deploy with the real deploy script's logic, inline (it is a CLI).
    const { createPublicClient, createWalletClient, http, defineChain } = await import('viem');
    const chain = defineChain({
      id: ARC_TESTNET_CHAIN_ID,
      name: 'arc-sim',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
    const pub = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: 20 });
    const wallet = createWalletClient({ chain, transport: http(rpcUrl), account: deployer });
    const deploy = async (name: string, args: unknown[] = []) => {
      const a = artifact(name);
      const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
      return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    const { keyHashOf, publicKeyOf } = await import('../../backend/src/chain/vrfProof.js');
    const pk = publicKeyOf(ORACLE_SK);
    const store = await deploy('BlockhashStore');
    const coordinator = await deploy('AkipolyVRFCoordinator', [store]);
    const rounds = await deploy('AkipolyRounds', [coordinator, treasury.address, keyHashOf(pk), 1, 200_000]);
    const coordAbi = artifact('AkipolyVRFCoordinator').abi;
    for (const [functionName, args] of [
      ['registerProvingKey', [pk]],
      ['addConsumer', [rounds]],
    ] as const) {
      const hash = await wallet.writeContract({ address: coordinator, abi: coordAbi, functionName, args } as never);
      await pub.waitForTransactionReceipt({ hash });
    }

    // Configure the backend exactly as production would, then load its modules.
    Object.assign(process.env, {
      DATABASE_URL: 'postgres://unused/unused',
      PRIVY_APP_ID: 'test',
      ARC_NETWORK: 'testnet',
      ARC_RPC_URL: rpcUrl,
      TREASURY_PRIVATE_KEY: toHex(treasury.getHdKey().privateKey!),
      VRF_ROUNDS_ADDRESS: rounds,
      VRF_COORDINATOR_ADDRESS: coordinator,
      VRF_ORACLE_KEY: toHex(ORACLE_SK, { size: 32 }),
    });
    usdc = await import('../../backend/src/chain/usdc.js');
    vrf = await import('../../backend/src/chain/vrf.js');
  });

  after(async () => {
    await server.close();
  });

  it('startup check passes for a correctly wired deployment', async () => {
    assert.deepEqual(await vrf.checkVrfSetup(), { mismatches: [], unreachable: null });
  });

  it('treasury requests, oracle proves, chain verifies, ball is read back', async () => {
    const gameId = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const pub = usdc.publicClient;

    const req = await vrf.signRequestBall(gameId, 1);
    await usdc.broadcast(req.raw);
    const reqReceipt = await pub.waitForTransactionReceipt({ hash: req.hash });
    assert.equal(reqReceipt.status, 'success');
    const parsed = vrf.parseRequest(reqReceipt);
    assert.ok(parsed, 'RandomWordsRequested parsed');
    assert.equal(parsed.minConfirmations, 1);

    // Confirmations: the oracle waits for the next block before proving.
    await (pub as unknown as { request: (a: unknown) => Promise<unknown> }).request({ method: 'evm_mine', params: [] });

    const ful = await vrf.signFulfill(parsed);
    await usdc.broadcast(ful.raw);
    const fulReceipt = await pub.waitForTransactionReceipt({ hash: ful.hash });
    assert.equal(fulReceipt.status, 'success');
    const f = vrf.parseFulfillment(fulReceipt, parsed.requestId);
    assert.ok(f && f.success && f.ball !== null);
    assert.equal(f.outputSeed, ful.output);

    const draw = await vrf.readDraw(gameId, 1);
    assert.equal(draw.fulfilled, true);
    assert.equal(draw.ball, f.ball);
    assert.equal(draw.randomWord, f.randomWord);
    assert.equal(draw.ball, Number(draw.randomWord % 17n));

    // The browser's review check, reading this same chain.
    const reported = {
      requestId: parsed.requestId.toString(),
      requestTx: req.hash,
      requestBlock: parsed.blockNumber.toString(),
      fulfillTx: ful.hash,
      randomWord: f.randomWord!.toString(),
    };
    const readDraw = (g: string, n: number) => vrf.readDraw(g, n);
    assert.equal(await verifyVrfRound(readDraw, gameId, 1, f.ball, reported), 'verified');
    assert.equal(await verifyVrfRound(readDraw, gameId, 1, (f.ball + 1) % 17, reported), 'mismatch');
    assert.equal(await verifyVrfRound(readDraw, gameId, 2, f.ball, reported), 'mismatch'); // round never drawn
  });

  it('the treasury cannot re-request a round', async () => {
    const gameId = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await assert.rejects(vrf.signRequestBall(gameId, 1)); // gas estimation hits AlreadyRequested
  });
});
