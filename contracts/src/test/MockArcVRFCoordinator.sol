// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcVRFClient} from "../ArcVRFClient.sol";

interface IRawFulfill {
  function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/**
 * @title MockArcVRFCoordinator
 * @notice TEST ONLY. Stands in for the hosted Arc VRF coordinator: records each
 * request exactly as the real one receives it and lets a test deliver a word.
 * Never deploy this outside tests.
 */
contract MockArcVRFCoordinator {
  struct Recorded {
    address sender;
    bytes32 keyHash;
    uint256 subId;
    uint16 requestConfirmations;
    uint32 callbackGasLimit;
    uint32 numWords;
    bytes extraArgs;
  }

  uint256 public nextRequestId = 1;
  mapping(uint256 => Recorded) public requests;
  mapping(uint256 => address[]) internal s_consumers;

  event RandomWordsRequested(uint256 indexed requestId, address indexed sender, uint256 subId);

  function requestRandomWords(ArcVRFClient.RandomWordsRequest calldata req) external returns (uint256 requestId) {
    requestId = nextRequestId++;
    requests[requestId] = Recorded({
      sender: msg.sender,
      keyHash: req.keyHash,
      subId: req.subId,
      requestConfirmations: req.requestConfirmations,
      callbackGasLimit: req.callbackGasLimit,
      numWords: req.numWords,
      extraArgs: req.extraArgs
    });
    emit RandomWordsRequested(requestId, msg.sender, req.subId);
  }

  /// @notice Deliver a word the way the real coordinator does after verifying its proof.
  function fulfill(uint256 requestId, uint256 word) external {
    address consumer = requests[requestId].sender;
    require(consumer != address(0), "unknown request");
    uint256[] memory words = new uint256[](1);
    words[0] = word;
    IRawFulfill(consumer).rawFulfillRandomWords(requestId, words);
  }

  /// @notice Call a consumer's callback directly (e.g. for an id it never asked for).
  function fulfillRaw(address consumer, uint256 requestId, uint256 word) external {
    uint256[] memory words = new uint256[](1);
    words[0] = word;
    IRawFulfill(consumer).rawFulfillRandomWords(requestId, words);
  }

  function addConsumer(uint256 subId, address consumer) external {
    s_consumers[subId].push(consumer);
  }

  function getSubscription(uint256 subId)
    external
    view
    returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)
  {
    return (0, 5 ether, 0, address(this), s_consumers[subId]);
  }
}
