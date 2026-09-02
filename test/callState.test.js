const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  ACCEPT_PENDING_CALL_SCRIPT,
  ACTIVE_CALL_TTL_MS,
  CLAIM_TIMED_OUT_CALLS_SCRIPT,
  CALL_TIMEOUTS_KEY,
  CREATE_PENDING_CALL_SCRIPT,
  FINALIZE_TIMED_OUT_CALL_SCRIPT,
  TERMINATE_CALL_SCRIPT,
  callKey,
  callSocketKey,
  callTimeoutClaimKey,
  callUserKey,
  cleanupCallsForSocket,
  acceptPendingCall,
  createPendingCall,
  claimTimedOutCallIds,
  endCall,
  finalizeTimedOutCall,
  rejectPendingCall,
} = require("../service/callState.service");

const CALL_ID = "123e4567-e89b-42d3-a456-426614174000";
const CALLER_ID = "507f1f77bcf86cd799439011";
const CALLEE_ID = "507f1f77bcf86cd799439012";

const createRedisRecorder = (result) => {
  const calls = [];
  return {
    calls,
    async eval(script, options) {
      calls.push({ script, options });
      return result;
    },
  };
};

test("creates a bounded pending call and locks both users atomically", async () => {
  const redisClient = createRedisRecorder("CREATED");
  const result = await createPendingCall({
    callId: CALL_ID,
    callerId: CALLER_ID,
    calleeId: CALLEE_ID,
    callerSocketId: "caller-socket",
    type: "video",
    now: 1_000,
    ttlMs: 60_000,
    redisClient,
  });

  assert.deepEqual(result, {
    callId: CALL_ID,
    expiresAt: 61_000,
    status: "pending",
  });
  assert.deepEqual(redisClient.calls[0].options, {
    keys: [
      callKey(CALL_ID),
      callUserKey(CALLER_ID),
      callUserKey(CALLEE_ID),
      callSocketKey("caller-socket"),
      CALL_TIMEOUTS_KEY,
    ],
    arguments: [
      "60000",
      CALLER_ID,
      CALLEE_ID,
      "caller-socket",
      "video",
      "1000",
      "61000",
      CALL_ID,
      "180000",
    ],
  });
  assert.match(CREATE_PENDING_CALL_SCRIPT, /USER_BUSY/);
  assert.match(CREATE_PENDING_CALL_SCRIPT, /ZADD/);
});

test("maps atomic busy and call collision results to stable errors", async () => {
  await assert.rejects(
    createPendingCall({
      callId: CALL_ID,
      callerId: CALLER_ID,
      calleeId: CALLEE_ID,
      callerSocketId: "caller-socket",
      type: "audio",
      redisClient: createRedisRecorder("USER_BUSY"),
    }),
    (error) => error.code === "USER_BUSY",
  );
  await assert.rejects(
    createPendingCall({
      callId: CALL_ID,
      callerId: CALLER_ID,
      calleeId: CALLEE_ID,
      callerSocketId: "caller-socket",
      type: "audio",
      redisClient: createRedisRecorder("CALL_EXISTS"),
    }),
    (error) => error.code === "CALL_EXISTS",
  );
});

test("rejects malformed call identity before Redis access", async () => {
  const redisClient = createRedisRecorder("CREATED");
  await assert.rejects(
    createPendingCall({
      callId: "bad",
      callerId: CALLER_ID,
      calleeId: CALLEE_ID,
      callerSocketId: "caller-socket",
      type: "video",
      redisClient,
    }),
    /valid call id/,
  );
  assert.equal(redisClient.calls.length, 0);
});

test("never stores WebRTC signaling payloads in call state", () => {
  assert.doesNotMatch(CREATE_PENDING_CALL_SCRIPT, /signal|sdp|offer|answer/i);
  assert.doesNotMatch(ACCEPT_PENDING_CALL_SCRIPT, /signal|sdp|offer|answer/i);
});

test("atomically binds the first answering callee socket", async () => {
  const redisClient = createRedisRecorder([
    "ACCEPTED",
    CALLER_ID,
    "caller-socket",
  ]);
  const result = await acceptPendingCall({
    callId: CALL_ID,
    calleeId: CALLEE_ID,
    calleeSocketId: "callee-socket-a",
    now: 2_000,
    redisClient,
  });

  assert.deepEqual(result, {
    callId: CALL_ID,
    callerId: CALLER_ID,
    callerSocketId: "caller-socket",
    status: "active",
  });
  assert.deepEqual(redisClient.calls[0].options.keys, [
    callKey(CALL_ID),
    callUserKey(CALLEE_ID),
    callSocketKey("callee-socket-a"),
    CALL_TIMEOUTS_KEY,
  ]);
  assert.equal(redisClient.calls[0].options.arguments[4], String(ACTIVE_CALL_TTL_MS));
  assert.match(ACCEPT_PENDING_CALL_SCRIPT, /status", "active"/);
  assert.match(ACCEPT_PENDING_CALL_SCRIPT, /ZREM/);
});

test("rejects later answers after another device wins", async () => {
  await assert.rejects(
    acceptPendingCall({
      callId: CALL_ID,
      calleeId: CALLEE_ID,
      calleeSocketId: "callee-socket-b",
      redisClient: createRedisRecorder(["CALL_NOT_PENDING"]),
    }),
    (error) => error.code === "CALL_NOT_PENDING",
  );
});

test("rejects a non-callee answer with a stable authorization result", async () => {
  await assert.rejects(
    acceptPendingCall({
      callId: CALL_ID,
      calleeId: CALLER_ID,
      calleeSocketId: "attacker-socket",
      redisClient: createRedisRecorder(["CALL_RESPONSE_DENIED"]),
    }),
    (error) => error.code === "CALL_RESPONSE_DENIED",
  );
});

test("atomically rejects a pending call and releases its locks", async () => {
  const redisClient = createRedisRecorder([
    "TERMINATED",
    "pending",
    CALLER_ID,
    "caller-socket",
  ]);
  const result = await rejectPendingCall({
    callId: CALL_ID,
    actorId: CALLEE_ID,
    actorSocketId: "callee-device-b",
    redisClient,
  });

  assert.deepEqual(result, {
    callId: CALL_ID,
    peerSocketId: "caller-socket",
    peerUserId: CALLER_ID,
    previousStatus: "pending",
  });
  assert.deepEqual(redisClient.calls[0].options.keys, [
    callKey(CALL_ID),
    CALL_TIMEOUTS_KEY,
  ]);
  assert.match(TERMINATE_CALL_SCRIPT, /CALL_NOT_PENDING/);
  assert.match(TERMINATE_CALL_SCRIPT, /SREM/);
  assert.match(TERMINATE_CALL_SCRIPT, /ZREM/);
});

test("ends an active call only from its bound participant socket", async () => {
  const accepted = createRedisRecorder([
    "TERMINATED",
    "active",
    CALLEE_ID,
    "callee-socket",
  ]);
  assert.deepEqual(
    await endCall({
      callId: CALL_ID,
      actorId: CALLER_ID,
      actorSocketId: "caller-socket",
      redisClient: accepted,
    }),
    {
      callId: CALL_ID,
      peerSocketId: "callee-socket",
      peerUserId: CALLEE_ID,
      previousStatus: "active",
    },
  );

  await assert.rejects(
    endCall({
      callId: CALL_ID,
      actorId: CALLER_ID,
      actorSocketId: "different-device",
      redisClient: createRedisRecorder(["CALL_ACTION_DENIED"]),
    }),
    (error) => error.code === "CALL_ACTION_DENIED",
  );
});

test("conditional lock deletion cannot remove a newer call", () => {
  assert.match(
    TERMINATE_CALL_SCRIPT,
    /if redis\.call\("GET", callerUserKey\) == ARGV\[3\]/,
  );
  assert.match(
    TERMINATE_CALL_SCRIPT,
    /if redis\.call\("GET", calleeUserKey\) == ARGV\[3\]/,
  );
});

test("claims timed out calls with a retryable distributed lease", async () => {
  const redisClient = createRedisRecorder([CALL_ID]);
  assert.deepEqual(
    await claimTimedOutCallIds({
      now: 70_000,
      limit: 20,
      claimToken: "timeout-token-123456",
      claimTtlMs: 120_000,
      redisClient,
    }),
    [CALL_ID],
  );
  assert.match(CLAIM_TIMED_OUT_CALLS_SCRIPT, /"NX"/);
  assert.doesNotMatch(CLAIM_TIMED_OUT_CALLS_SCRIPT, /ZREM/);
});

test("finalizes a pending timeout and returns its notification target", async () => {
  const redisClient = createRedisRecorder([
    "TIMED_OUT",
    CALLER_ID,
    "caller-socket",
    CALLEE_ID,
  ]);
  const result = await finalizeTimedOutCall({
    callId: CALL_ID,
    claimToken: "timeout-token-123456",
    now: 70_001,
    redisClient,
  });

  assert.deepEqual(result, {
    callId: CALL_ID,
    calleeId: CALLEE_ID,
    callerId: CALLER_ID,
    callerSocketId: "caller-socket",
  });
  assert.deepEqual(redisClient.calls[0].options.keys, [
    callKey(CALL_ID),
    CALL_TIMEOUTS_KEY,
    callTimeoutClaimKey(CALL_ID),
  ]);
  assert.match(FINALIZE_TIMED_OUT_CALL_SCRIPT, /status ~= "pending"/);
  assert.match(FINALIZE_TIMED_OUT_CALL_SCRIPT, /ZREM/);
});

test("cleans stale timeout index entries without emitting a call", async () => {
  assert.equal(
    await finalizeTimedOutCall({
      callId: CALL_ID,
      claimToken: "timeout-token-123456",
      redisClient: createRedisRecorder(["STALE_CALL"]),
    }),
    null,
  );
});

test("does not finalize a timeout after accept or lease loss", async () => {
  for (const code of ["CALL_NOT_TIMED_OUT", "CLAIM_LOST"]) {
    await assert.rejects(
      finalizeTimedOutCall({
        callId: CALL_ID,
        claimToken: "timeout-token-123456",
        redisClient: createRedisRecorder([code]),
      }),
      (error) => error.code === code,
    );
  }
});

test("disconnect cleanup atomically ends calls associated with its socket", async () => {
  const calls = [];
  const redisClient = {
    async sMembers(key) {
      assert.equal(key, callSocketKey("caller-socket"));
      return [CALL_ID];
    },
    async eval(script, options) {
      calls.push({ script, options });
      return ["TERMINATED", "active", CALLEE_ID, "callee-socket"];
    },
    async sRem() {
      throw new Error("should not remove a valid association separately");
    },
  };

  const result = await cleanupCallsForSocket({
    userId: CALLER_ID,
    socketId: "caller-socket",
    redisClient,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].peerSocketId, "callee-socket");
  assert.equal(calls[0].script, TERMINATE_CALL_SCRIPT);
});

test("disconnect cleanup removes stale socket associations", async () => {
  const removed = [];
  const redisClient = {
    async sMembers() {
      return [CALL_ID];
    },
    async eval() {
      return ["CALL_NOT_FOUND"];
    },
    async sRem(key, callId) {
      removed.push({ key, callId });
    },
  };

  assert.deepEqual(
    await cleanupCallsForSocket({
      userId: CALLER_ID,
      socketId: "caller-socket",
      redisClient,
    }),
    [],
  );
  assert.deepEqual(removed, [
    { key: callSocketKey("caller-socket"), callId: CALL_ID },
  ]);
});

test("call start uses distributed presence, call state and callee user room", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );
  const start = source.indexOf(
    'registerAsyncSocketHandler(socket, "callToUser"',
  );
  const end = source.indexOf(
    'registerAsyncSocketHandler(socket, "answeredCall"',
    start,
  );
  const block = source.slice(start, end);

  assert.match(block, /await isPresenceOnline\(\{ userId: calleeId \}\)/);
  assert.match(block, /await createPendingCall\(\{/);
  assert.match(block, /io\.to\(calleeId\)\.emit\("makeUser"/);
  assert.doesNotMatch(block, /activeCalls\.has|hasPendingCall/);
  assert.doesNotMatch(block, /callRejected[\s\S]*reason: "timeout"/);
});

test("call answer atomically selects one callee device across instances", () => {
  const socketSource = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );
  const start = socketSource.indexOf(
    'registerAsyncSocketHandler(socket, "answeredCall"',
  );
  const end = socketSource.indexOf(
    'registerAsyncSocketHandler(socket, "reject-call"',
    start,
  );
  const block = socketSource.slice(start, end);

  assert.match(block, /await acceptPendingCall\(\{/);
  assert.match(block, /calleeSocketId: socket\.id/);
  assert.match(block, /io\.to\(acceptedCall\.callerSocketId\)\.emit\("callAccepted"/);
  assert.match(block, /socket\.to\(userId\)\.emit\("callAnsweredElsewhere"/);
  assert.doesNotMatch(block, /pendingCalls\.get\(callId\)/);

  const clientSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Components/CallDialog/index.jsx"),
    "utf8",
  );
  assert.match(clientSource, /socket\.on\("callAnsweredElsewhere"/);
  assert.match(clientSource, /callIdRef\.current !== callId/);
  assert.match(clientSource, /socket\.off\("callAnsweredElsewhere"/);
});

test("call rejection terminates distributed pending state", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );
  const start = source.indexOf(
    'registerAsyncSocketHandler(socket, "reject-call"',
  );
  const end = source.indexOf(
    'registerAsyncSocketHandler(socket, "end-call"',
    start,
  );
  const block = source.slice(start, end);

  assert.match(block, /await rejectPendingCall\(\{/);
  assert.match(block, /actorId: userId/);
  assert.match(block, /actorSocketId: socket\.id/);
  assert.match(block, /io\.to\(rejectedCall\.peerSocketId\)\.emit\("callRejected"/);
  assert.match(block, /socket\.to\(userId\)\.emit\("callEnded"/);
  assert.doesNotMatch(block, /pendingCalls\.get\(callId\)/);
});

test("call end terminates distributed pending or active state", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );
  const start = source.indexOf(
    'registerAsyncSocketHandler(socket, "end-call"',
  );
  const end = source.indexOf("//disconnect", start);
  const block = source.slice(start, end);

  assert.match(block, /await endCall\(\{/);
  assert.match(block, /actorId: userId/);
  assert.match(block, /actorSocketId: socket\.id/);
  assert.match(block, /endedCall\.peerSocketId \|\| endedCall\.peerUserId/);
  assert.match(block, /io\.to\(peerTarget\)\.emit\("callEnded"/);
  assert.match(block, /socket\.to\(userId\)\.emit\("callEnded"/);
  assert.doesNotMatch(block, /pendingCalls\.get\(callId\)/);
  assert.doesNotMatch(block, /activeCall\.socketId !== socket\.id/);
});

test("socket disconnect terminates its distributed calls", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );
  const start = source.indexOf(
    'registerAsyncSocketHandler(socket, "disconnect"',
  );
  const end = source.indexOf("const getIO", start);
  const block = source.slice(start, end);

  assert.match(block, /await cleanupCallsForSocket\(\{/);
  assert.match(block, /userId,[\s\S]*socketId: socket\.id/);
  assert.match(
    block,
    /terminatedCall\.peerSocketId \|\| terminatedCall\.peerUserId/,
  );
  assert.match(block, /io\.to\(peerTarget\)\.emit\("callEnded"/);
});

test("socket server has no process-local call state", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /const activeCalls = new Map/);
  assert.doesNotMatch(source, /const pendingCalls = new Map/);
  assert.doesNotMatch(source, /removePendingCall|hasPendingCall/);
});
