// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRF} from "./vrf/VRF.sol";
import {BlockhashStore} from "./BlockhashStore.sol";

/**
 * @title AkipolyVRFCoordinator
 * @notice Akipoly's own verifiable randomness coordinator for Arc, modelled on
 * Chainlink's VRFCoordinatorV2_5. The request/fulfill flow, preSeed/requestId
 * derivation, request commitments, proof verification and word expansion follow
 * v2.5. Subscriptions and LINK/native billing are dropped: consumers are an
 * owner-managed allowlist and each caller pays its own gas.
 *
 * Flow:
 *  1. A consumer calls requestRandomWords. The coordinator derives
 *     preSeed = keccak256(keyHash, consumer, nonce), stores a commitment to the
 *     request (including the block it landed in) and emits RandomWordsRequested.
 *  2. The oracle waits for confirmations. It then proves the VRF over
 *     keccak256(preSeed, blockhash(requestBlock)). That block hash was unknown
 *     when the request was made.
 *  3. Anyone may call fulfillRandomWords with the proof. The coordinator checks
 *     the commitment, verifies the proof on-chain, expands the output into words
 *     and calls the consumer back. An invalid proof reverts, so the oracle can
 *     only withhold a result and never choose one.
 */
contract AkipolyVRFCoordinator is VRF {
  // ---------------------------------------------------------------- constants
  uint16 public constant MAX_REQUEST_CONFIRMATIONS = 200;
  uint32 public constant MAX_NUM_WORDS = 500;
  // 5k is plenty for an EXTCODESIZE call (2600) + warm CALL (100) and some arithmetic operations.
  uint256 private constant GAS_FOR_CALL_EXACT_CHECK = 5_000;

  BlockhashStore public immutable BLOCKHASH_STORE;

  // ------------------------------------------------------------------- errors
  error OnlyOwner();
  error OnlyPendingOwner();
  error ZeroAddress();
  error InvalidConsumer(address consumer);
  error InvalidRequestConfirmations(uint16 have, uint16 min, uint16 max);
  error GasLimitTooBig(uint32 have, uint32 want);
  error NumWordsTooBig(uint32 have, uint32 want);
  error ProvingKeyAlreadyRegistered(bytes32 keyHash);
  error NoSuchProvingKey(bytes32 keyHash);
  error InvalidKeyHash(bytes32 keyHash);
  error NoCorrespondingRequest();
  error IncorrectCommitment();
  error BlockhashNotInStore(uint256 blockNum);
  error Reentrant();
  error InsufficientGasForConsumer(uint256 have, uint256 want);

  // ------------------------------------------------------------------- events
  event OwnershipTransferRequested(address indexed from, address indexed to);
  event OwnershipTransferred(address indexed from, address indexed to);
  event ConfigSet(uint16 minimumRequestConfirmations, uint32 maxGasLimit);
  event ProvingKeyRegistered(bytes32 keyHash);
  event ProvingKeyDeregistered(bytes32 keyHash);
  event ConsumerAdded(address consumer);
  event ConsumerRemoved(address consumer);
  event RandomWordsRequested(
    bytes32 indexed keyHash,
    uint256 requestId,
    uint256 preSeed,
    uint16 minimumRequestConfirmations,
    uint32 callbackGasLimit,
    uint32 numWords,
    address indexed sender
  );
  event RandomWordsFulfilled(uint256 indexed requestId, uint256 outputSeed, bool success);

  // -------------------------------------------------------------------- state
  struct Config {
    uint16 minimumRequestConfirmations;
    uint32 maxGasLimit;
    // Stops a consumer from requesting more randomness from inside its callback.
    bool reentrancyLock;
  }

  // What the oracle passes back alongside the proof. Its hash must match what
  // was stored at request time.
  struct RequestCommitment {
    uint64 blockNum;
    uint32 callbackGasLimit;
    uint32 numWords;
    address sender;
  }

  address public owner;
  address public pendingOwner;
  Config public s_config;
  mapping(bytes32 keyHash => bool) public s_provingKeys;
  bytes32[] public s_provingKeyHashes;
  mapping(address consumer => bool) public s_consumers;
  mapping(address consumer => uint64) public s_nonces;
  mapping(uint256 requestId => bytes32) public s_requestCommitments;

  constructor(address blockhashStore) {
    if (blockhashStore == address(0)) revert ZeroAddress();
    BLOCKHASH_STORE = BlockhashStore(blockhashStore);
    owner = msg.sender;
    s_config = Config({minimumRequestConfirmations: 1, maxGasLimit: 2_500_000, reentrancyLock: false});
    emit OwnershipTransferred(address(0), msg.sender);
    emit ConfigSet(1, 2_500_000);
  }

  modifier onlyOwner() {
    if (msg.sender != owner) revert OnlyOwner();
    _;
  }

  modifier nonReentrant() {
    if (s_config.reentrancyLock) revert Reentrant();
    _;
  }

  // ------------------------------------------------------------------- admin
  function transferOwnership(address to) external onlyOwner {
    pendingOwner = to;
    emit OwnershipTransferRequested(owner, to);
  }

  function acceptOwnership() external {
    if (msg.sender != pendingOwner) revert OnlyPendingOwner();
    emit OwnershipTransferred(owner, msg.sender);
    owner = msg.sender;
    pendingOwner = address(0);
  }

  function setConfig(uint16 minimumRequestConfirmations, uint32 maxGasLimit) external onlyOwner {
    if (minimumRequestConfirmations > MAX_REQUEST_CONFIRMATIONS) {
      revert InvalidRequestConfirmations(
        minimumRequestConfirmations,
        minimumRequestConfirmations,
        MAX_REQUEST_CONFIRMATIONS
      );
    }
    s_config.minimumRequestConfirmations = minimumRequestConfirmations;
    s_config.maxGasLimit = maxGasLimit;
    emit ConfigSet(minimumRequestConfirmations, maxGasLimit);
  }

  /// @notice Registers an oracle's VRF public key. Its keyHash is keccak256(abi.encode(publicProvingKey)).
  function registerProvingKey(uint256[2] calldata publicProvingKey) external onlyOwner {
    bytes32 kh = hashOfKey(publicProvingKey);
    if (s_provingKeys[kh]) revert ProvingKeyAlreadyRegistered(kh);
    s_provingKeys[kh] = true;
    s_provingKeyHashes.push(kh);
    emit ProvingKeyRegistered(kh);
  }

  function deregisterProvingKey(uint256[2] calldata publicProvingKey) external onlyOwner {
    bytes32 kh = hashOfKey(publicProvingKey);
    if (!s_provingKeys[kh]) revert NoSuchProvingKey(kh);
    delete s_provingKeys[kh];
    uint256 n = s_provingKeyHashes.length;
    for (uint256 i = 0; i < n; ++i) {
      if (s_provingKeyHashes[i] == kh) {
        s_provingKeyHashes[i] = s_provingKeyHashes[n - 1];
        s_provingKeyHashes.pop();
        break;
      }
    }
    emit ProvingKeyDeregistered(kh);
  }

  function addConsumer(address consumer) external onlyOwner {
    if (consumer == address(0)) revert ZeroAddress();
    s_consumers[consumer] = true;
    emit ConsumerAdded(consumer);
  }

  function removeConsumer(address consumer) external onlyOwner {
    delete s_consumers[consumer];
    emit ConsumerRemoved(consumer);
  }

  // ------------------------------------------------------------------- views
  function hashOfKey(uint256[2] memory publicKey) public pure returns (bytes32) {
    return keccak256(abi.encode(publicKey));
  }

  function provingKeyHashes() external view returns (bytes32[] memory) {
    return s_provingKeyHashes;
  }

  /// @notice Pending requests have a non-zero commitment. It is deleted on fulfillment.
  function pendingRequestExists(uint256 requestId) external view returns (bool) {
    return s_requestCommitments[requestId] != 0;
  }

  // ----------------------------------------------------------------- request
  /**
   * @notice Request randomness. Only allowlisted consumer contracts may call this.
   * @param keyHash which registered oracle key must answer
   * @param requestConfirmations blocks the oracle waits before answering
   * @param callbackGasLimit gas forwarded to the consumer's rawFulfillRandomWords
   * @param numWords number of uint256 words to return
   * @return requestId unique id, passed back to the consumer on fulfillment
   */
  function requestRandomWords(
    bytes32 keyHash,
    uint16 requestConfirmations,
    uint32 callbackGasLimit,
    uint32 numWords
  ) external nonReentrant returns (uint256 requestId) {
    if (!s_consumers[msg.sender]) revert InvalidConsumer(msg.sender);
    if (!s_provingKeys[keyHash]) revert InvalidKeyHash(keyHash);
    Config memory config = s_config;
    if (requestConfirmations < config.minimumRequestConfirmations || requestConfirmations > MAX_REQUEST_CONFIRMATIONS) {
      revert InvalidRequestConfirmations(
        requestConfirmations,
        config.minimumRequestConfirmations,
        MAX_REQUEST_CONFIRMATIONS
      );
    }
    if (callbackGasLimit > config.maxGasLimit) revert GasLimitTooBig(callbackGasLimit, config.maxGasLimit);
    if (numWords > MAX_NUM_WORDS || numWords == 0) revert NumWordsTooBig(numWords, MAX_NUM_WORDS);

    // Each request gets a fresh nonce, so even identical requests get unique ids.
    uint64 nonce = s_nonces[msg.sender] + 1;
    s_nonces[msg.sender] = nonce;
    uint256 preSeed;
    (requestId, preSeed) = _computeRequestId(keyHash, msg.sender, nonce);

    s_requestCommitments[requestId] = keccak256(
      abi.encode(requestId, uint64(block.number), callbackGasLimit, numWords, msg.sender)
    );
    emit RandomWordsRequested(keyHash, requestId, preSeed, requestConfirmations, callbackGasLimit, numWords, msg.sender);
    return requestId;
  }

  function _computeRequestId(
    bytes32 keyHash,
    address sender,
    uint64 nonce
  ) internal pure returns (uint256 requestId, uint256 preSeed) {
    preSeed = uint256(keccak256(abi.encode(keyHash, sender, nonce)));
    requestId = uint256(keccak256(abi.encode(keyHash, preSeed)));
  }

  // ----------------------------------------------------------------- fulfill
  /**
   * @notice Deliver a proven random value to the requesting consumer. Anyone can
   * call this: the proof decides, not the caller.
   * @param proof VRF proof. proof.seed is the request's preSeed.
   * @param rc the request commitment emitted at request time
   * @return outputSeed the verified VRF output that the words were expanded from
   */
  function fulfillRandomWords(
    Proof calldata proof,
    RequestCommitment calldata rc
  ) external nonReentrant returns (uint256 outputSeed) {
    uint256 requestId;
    (requestId, outputSeed) = _getRandomnessFromProof(proof, rc);

    uint256[] memory randomWords = new uint256[](rc.numWords);
    for (uint256 i = 0; i < rc.numWords; ++i) {
      randomWords[i] = uint256(keccak256(abi.encode(outputSeed, i)));
    }

    // Delete first so the request can never be fulfilled twice, even if the
    // callback fails.
    delete s_requestCommitments[requestId];
    bytes memory resp = abi.encodeWithSignature(
      "rawFulfillRandomWords(uint256,uint256[])",
      requestId,
      randomWords
    );
    // Lock re-entry while the consumer runs. A consumer that reverts or runs out
    // of gas does not undo the fulfillment: it is recorded and emitted with
    // success=false, as in v2.5.
    s_config.reentrancyLock = true;
    bool success = _callWithExactGas(rc.callbackGasLimit, rc.sender, resp);
    s_config.reentrancyLock = false;

    emit RandomWordsFulfilled(requestId, outputSeed, success);
    return outputSeed;
  }

  function _getRandomnessFromProof(
    Proof calldata proof,
    RequestCommitment calldata rc
  ) internal view returns (uint256 requestId, uint256 randomness) {
    bytes32 keyHash = hashOfKey(proof.pk);
    if (!s_provingKeys[keyHash]) revert NoSuchProvingKey(keyHash);
    requestId = uint256(keccak256(abi.encode(keyHash, proof.seed)));
    bytes32 commitment = s_requestCommitments[requestId];
    if (commitment == 0) revert NoCorrespondingRequest();
    if (commitment != keccak256(abi.encode(requestId, rc.blockNum, rc.callbackGasLimit, rc.numWords, rc.sender))) {
      revert IncorrectCommitment();
    }

    bytes32 blockHash = blockhash(rc.blockNum);
    if (blockHash == bytes32(0)) {
      // Older than 256 blocks: fall back to the BlockhashStore.
      try BLOCKHASH_STORE.getBlockhash(rc.blockNum) returns (bytes32 stored) {
        blockHash = stored;
      } catch {
        revert BlockhashNotInStore(rc.blockNum);
      }
    }

    // The value the VRF is actually proven over: the request's preSeed mixed
    // with a block hash that did not exist when the request was made.
    uint256 actualSeed = uint256(keccak256(abi.encodePacked(proof.seed, blockHash)));
    randomness = _randomValueFromVRFProof(proof, actualSeed); // Reverts on invalid proof
  }

  /**
   * @dev Calls target with exactly gasAmount gas (EIP-150 aware), or reverts if
   * that much gas cannot be forwarded. Prevents the fulfiller from starving the
   * consumer of gas on purpose. Ported from Chainlink's VRFCoordinatorV2_5.
   */
  function _callWithExactGas(uint256 gasAmount, address target, bytes memory data) private returns (bool success) {
    assembly {
      let g := gas()
      // Compute g -= GAS_FOR_CALL_EXACT_CHECK and check for underflow
      // The gas actually passed to the callee is min(gasAmount, 63//64*gas available).
      // We want to ensure that we revert if gasAmount >  63//64*gas available
      // as we do not want to provide them with less, however that check itself costs
      // gas.  GAS_FOR_CALL_EXACT_CHECK ensures we have at least enough gas to be able
      // to revert if gasAmount >  63//64*gas available.
      if lt(g, GAS_FOR_CALL_EXACT_CHECK) {
        revert(0, 0)
      }
      g := sub(g, GAS_FOR_CALL_EXACT_CHECK)
      // if g - g//64 <= gasAmount, revert
      // (we subtract g//64 because of EIP-150)
      if iszero(gt(sub(g, div(g, 64)), gasAmount)) {
        revert(0, 0)
      }
      // solidity calls check that a contract actually exists at the destination, so we do the same
      if iszero(extcodesize(target)) {
        revert(0, 0)
      }
      // call and return whether we succeeded. ignore return data
      // call(gas,addr,value,argsOffset,argsLength,retOffset,retLength)
      success := call(gasAmount, target, 0, add(data, 0x20), mload(data), 0, 0)
    }
    return success;
  }
}
