const redis = require("../config/redis");

const PENDING_CALL_TTL_MS = 60_000;
const ACTIVE_CALL_TTL_MS = 4 * 60 * 60 * 1000;
const CALL_STATE_RETENTION_MS = 120_000;
const CALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_ID_PATTERN = /^[a-f\d]{24}$/i;
const CALL_KEY_PREFIX = "call:{calls}:state:";
const CALL_USER_KEY_PREFIX = "call:{calls}:user:";
const CALL_SOCKET_KEY_PREFIX = "call:{calls}:socket:";
const CALL_TIMEOUTS_KEY = "call:{calls}:timeouts";
const CALL_TIMEOUT_CLAIM_KEY_PREFIX = "call:{calls}:timeout-claim:";

const CREATE_PENDING_CALL_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return "CALL_EXISTS"
end
if redis.call("EXISTS", KEYS[2]) == 1 or redis.call("EXISTS", KEYS[3]) == 1 then
  return "USER_BUSY"
end
redis.call(
  "HSET",
  KEYS[1],
  "status", "pending",
  "callerId", ARGV[2],
  "calleeId", ARGV[3],
  "callerSocketId", ARGV[4],
  "type", ARGV[5],
  "createdAt", ARGV[6],
  "expiresAt", ARGV[7]
)
redis.call("PEXPIRE", KEYS[1], ARGV[9])
redis.call("SET", KEYS[2], ARGV[8], "PX", ARGV[1])
redis.call("SET", KEYS[3], ARGV[8], "PX", ARGV[1])
redis.call("SADD", KEYS[4], ARGV[8])
redis.call("PEXPIRE", KEYS[4], ARGV[1])
redis.call("ZADD", KEYS[5], ARGV[7], ARGV[8])
return "CREATED"
`;

const ACCEPT_PENDING_CALL_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return {"CALL_NOT_FOUND"}
end
if redis.call("HGET", KEYS[1], "status") ~= "pending" then
  return {"CALL_NOT_PENDING"}
end
if redis.call("HGET", KEYS[1], "calleeId") ~= ARGV[1] then
  return {"CALL_RESPONSE_DENIED"}
end
local callerId = redis.call("HGET", KEYS[1], "callerId")
local callerUserKey = ARGV[7] .. callerId
if redis.call("GET", KEYS[2]) ~= ARGV[2] or redis.call("GET", callerUserKey) ~= ARGV[2] then
  return {"CALL_EXPIRED"}
end
local callerSocketId = redis.call("HGET", KEYS[1], "callerSocketId")
redis.call(
  "HSET",
  KEYS[1],
  "status", "active",
  "calleeSocketId", ARGV[3],
  "acceptedAt", ARGV[4]
)
redis.call("PEXPIRE", KEYS[1], ARGV[5])
redis.call("PEXPIRE", KEYS[2], ARGV[5])
redis.call("PEXPIRE", callerUserKey, ARGV[5])
local callerSocketKey = ARGV[6] .. callerSocketId
redis.call("SADD", callerSocketKey, ARGV[2])
redis.call("PEXPIRE", callerSocketKey, ARGV[5])
redis.call("SADD", KEYS[3], ARGV[2])
redis.call("PEXPIRE", KEYS[3], ARGV[5])
redis.call("ZREM", KEYS[4], ARGV[2])
return {"ACCEPTED", callerId, callerSocketId}
`;

const TERMINATE_CALL_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return {"CALL_NOT_FOUND"}
end
local status = redis.call("HGET", KEYS[1], "status")
local callerId = redis.call("HGET", KEYS[1], "callerId")
local calleeId = redis.call("HGET", KEYS[1], "calleeId")
local callerSocketId = redis.call("HGET", KEYS[1], "callerSocketId")
local calleeSocketId = redis.call("HGET", KEYS[1], "calleeSocketId")
local authorized = false
if ARGV[4] == "reject" then
  if status ~= "pending" then
    return {"CALL_NOT_PENDING"}
  end
  authorized = ARGV[1] == calleeId
elseif status == "pending" then
  authorized = (ARGV[1] == callerId and ARGV[2] == callerSocketId) or ARGV[1] == calleeId
elseif status == "active" then
  authorized =
    (ARGV[1] == callerId and ARGV[2] == callerSocketId) or
    (ARGV[1] == calleeId and ARGV[2] == calleeSocketId)
end
if not authorized then
  return {"CALL_ACTION_DENIED"}
end
local peerUserId = callerId
local peerSocketId = callerSocketId
if ARGV[1] == callerId then
  peerUserId = calleeId
  peerSocketId = calleeSocketId or ""
end
local callerUserKey = ARGV[5] .. callerId
local calleeUserKey = ARGV[5] .. calleeId
if redis.call("GET", callerUserKey) == ARGV[3] then
  redis.call("DEL", callerUserKey)
end
if redis.call("GET", calleeUserKey) == ARGV[3] then
  redis.call("DEL", calleeUserKey)
end
local callerSocketKey = ARGV[6] .. callerSocketId
redis.call("SREM", callerSocketKey, ARGV[3])
if redis.call("SCARD", callerSocketKey) == 0 then
  redis.call("DEL", callerSocketKey)
end
if calleeSocketId and calleeSocketId ~= "" then
  local calleeSocketKey = ARGV[6] .. calleeSocketId
  redis.call("SREM", calleeSocketKey, ARGV[3])
  if redis.call("SCARD", calleeSocketKey) == 0 then
    redis.call("DEL", calleeSocketKey)
  end
end
redis.call("ZREM", KEYS[2], ARGV[3])
redis.call("DEL", KEYS[1])
return {"TERMINATED", status, peerUserId, peerSocketId}
`;

const CLAIM_TIMED_OUT_CALLS_SCRIPT = `
local candidates = redis.call(
  "ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, ARGV[2]
)
local claimed = {}
for _, callId in ipairs(candidates) do
  local claimKey = ARGV[3] .. callId
  if redis.call("SET", claimKey, ARGV[4], "NX", "PX", ARGV[5]) then
    table.insert(claimed, callId)
  end
end
return claimed
`;

const FINALIZE_TIMED_OUT_CALL_SCRIPT = `
if redis.call("GET", KEYS[3]) ~= ARGV[2] then
  return {"CLAIM_LOST"}
end
if redis.call("EXISTS", KEYS[1]) == 0 then
  redis.call("ZREM", KEYS[2], ARGV[1])
  redis.call("DEL", KEYS[3])
  return {"STALE_CALL"}
end
local status = redis.call("HGET", KEYS[1], "status")
local expiresAt = tonumber(redis.call("HGET", KEYS[1], "expiresAt") or "0")
if status ~= "pending" or expiresAt > tonumber(ARGV[3]) then
  redis.call("DEL", KEYS[3])
  return {"CALL_NOT_TIMED_OUT"}
end
local callerId = redis.call("HGET", KEYS[1], "callerId")
local calleeId = redis.call("HGET", KEYS[1], "calleeId")
local callerSocketId = redis.call("HGET", KEYS[1], "callerSocketId")
local callerUserKey = ARGV[4] .. callerId
local calleeUserKey = ARGV[4] .. calleeId
if redis.call("GET", callerUserKey) == ARGV[1] then
  redis.call("DEL", callerUserKey)
end
if redis.call("GET", calleeUserKey) == ARGV[1] then
  redis.call("DEL", calleeUserKey)
end
local callerSocketKey = ARGV[5] .. callerSocketId
redis.call("SREM", callerSocketKey, ARGV[1])
if redis.call("SCARD", callerSocketKey) == 0 then
  redis.call("DEL", callerSocketKey)
end
redis.call("ZREM", KEYS[2], ARGV[1])
redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[3])
return {"TIMED_OUT", callerId, callerSocketId, calleeId}
`;

class CallStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CallStateError";
    this.code = code;
  }
}

const callKey = (callId) => `${CALL_KEY_PREFIX}${callId}`;
const callUserKey = (userId) => `${CALL_USER_KEY_PREFIX}${userId}`;
const callSocketKey = (socketId) => `${CALL_SOCKET_KEY_PREFIX}${socketId}`;
const callTimeoutClaimKey = (callId) =>
  `${CALL_TIMEOUT_CLAIM_KEY_PREFIX}${callId}`;

const validateCallIdentity = ({
  callId,
  callerId,
  calleeId,
  callerSocketId,
  type,
}) => {
  if (typeof callId !== "string" || !CALL_ID_PATTERN.test(callId)) {
    throw new TypeError("A valid call id is required");
  }
  if (
    typeof callerId !== "string" ||
    !USER_ID_PATTERN.test(callerId) ||
    typeof calleeId !== "string" ||
    !USER_ID_PATTERN.test(calleeId) ||
    callerId === calleeId
  ) {
    throw new TypeError("Valid distinct call users are required");
  }
  if (
    typeof callerSocketId !== "string" ||
    callerSocketId.length === 0 ||
    callerSocketId.length > 200
  ) {
    throw new TypeError("A valid caller socket id is required");
  }
  if (!["audio", "video"].includes(type)) {
    throw new TypeError("A valid call type is required");
  }
};

const createPendingCall = async ({
  callId,
  callerId,
  calleeId,
  callerSocketId,
  type,
  now = Date.now(),
  ttlMs = PENDING_CALL_TTL_MS,
  redisClient = redis,
}) => {
  validateCallIdentity({
    callId,
    callerId,
    calleeId,
    callerSocketId,
    type,
  });
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new TypeError("Invalid call timing");
  }
  const expiresAt = now + ttlMs;
  const stateTtlMs = ttlMs + CALL_STATE_RETENTION_MS;
  const result = await redisClient.eval(CREATE_PENDING_CALL_SCRIPT, {
    keys: [
      callKey(callId),
      callUserKey(callerId),
      callUserKey(calleeId),
      callSocketKey(callerSocketId),
      CALL_TIMEOUTS_KEY,
    ],
    arguments: [
      String(ttlMs),
      callerId,
      calleeId,
      callerSocketId,
      type,
      String(now),
      String(expiresAt),
      callId,
      String(stateTtlMs),
    ],
  });

  if (result === "USER_BUSY") {
    throw new CallStateError("USER_BUSY", "A call participant is busy");
  }
  if (result === "CALL_EXISTS") {
    throw new CallStateError("CALL_EXISTS", "Call already exists");
  }
  if (result !== "CREATED") {
    throw new CallStateError("CALL_STATE_FAILED", "Could not create call state");
  }
  return { callId, expiresAt, status: "pending" };
};

const validateCallActionIdentity = ({ callId, userId, socketId }) => {
  if (typeof callId !== "string" || !CALL_ID_PATTERN.test(callId)) {
    throw new TypeError("A valid call id is required");
  }
  if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) {
    throw new TypeError("A valid call user is required");
  }
  if (
    typeof socketId !== "string" ||
    socketId.length === 0 ||
    socketId.length > 200
  ) {
    throw new TypeError("A valid call socket id is required");
  }
};

const acceptPendingCall = async ({
  callId,
  calleeId,
  calleeSocketId,
  now = Date.now(),
  activeTtlMs = ACTIVE_CALL_TTL_MS,
  redisClient = redis,
}) => {
  validateCallActionIdentity({
    callId,
    userId: calleeId,
    socketId: calleeSocketId,
  });
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(activeTtlMs) ||
    activeTtlMs < 1
  ) {
    throw new TypeError("Invalid call timing");
  }
  const result = await redisClient.eval(ACCEPT_PENDING_CALL_SCRIPT, {
    keys: [
      callKey(callId),
      callUserKey(calleeId),
      callSocketKey(calleeSocketId),
      CALL_TIMEOUTS_KEY,
    ],
    arguments: [
      calleeId,
      callId,
      calleeSocketId,
      String(now),
      String(activeTtlMs),
      CALL_SOCKET_KEY_PREFIX,
      CALL_USER_KEY_PREFIX,
    ],
  });
  const [status, callerId, callerSocketId] = result || [];
  if (status !== "ACCEPTED") {
    throw new CallStateError(
      status || "CALL_STATE_FAILED",
      "Could not accept call",
    );
  }
  return { callId, callerId, callerSocketId, status: "active" };
};

const terminateCall = async ({
  callId,
  actorId,
  actorSocketId,
  action,
  redisClient = redis,
}) => {
  validateCallActionIdentity({
    callId,
    userId: actorId,
    socketId: actorSocketId,
  });
  if (!["reject", "end"].includes(action)) {
    throw new TypeError("A valid call action is required");
  }
  const result = await redisClient.eval(TERMINATE_CALL_SCRIPT, {
    keys: [callKey(callId), CALL_TIMEOUTS_KEY],
    arguments: [
      actorId,
      actorSocketId,
      callId,
      action,
      CALL_USER_KEY_PREFIX,
      CALL_SOCKET_KEY_PREFIX,
    ],
  });
  const [resultCode, previousStatus, peerUserId, peerSocketId] = result || [];
  if (resultCode !== "TERMINATED") {
    throw new CallStateError(
      resultCode || "CALL_STATE_FAILED",
      "Could not terminate call",
    );
  }
  return {
    callId,
    peerSocketId: peerSocketId || null,
    peerUserId,
    previousStatus,
  };
};

const rejectPendingCall = (options) =>
  terminateCall({ ...options, action: "reject" });

const endCall = (options) => terminateCall({ ...options, action: "end" });

const claimTimedOutCallIds = async ({
  now = Date.now(),
  limit = 100,
  claimToken,
  claimTtlMs = 120_000,
  redisClient = redis,
} = {}) => {
  if (!Number.isSafeInteger(now)) throw new TypeError("Invalid call timing");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new TypeError("Invalid call cleanup limit");
  }
  if (typeof claimToken !== "string" || claimToken.length < 16) {
    throw new TypeError("Invalid call cleanup token");
  }
  if (!Number.isSafeInteger(claimTtlMs) || claimTtlMs < 1_000) {
    throw new TypeError("Invalid call cleanup TTL");
  }
  return redisClient.eval(CLAIM_TIMED_OUT_CALLS_SCRIPT, {
    keys: [CALL_TIMEOUTS_KEY],
    arguments: [
      String(now),
      String(limit),
      CALL_TIMEOUT_CLAIM_KEY_PREFIX,
      claimToken,
      String(claimTtlMs),
    ],
  });
};

const finalizeTimedOutCall = async ({
  callId,
  claimToken,
  now = Date.now(),
  redisClient = redis,
}) => {
  if (typeof callId !== "string" || !CALL_ID_PATTERN.test(callId)) {
    throw new TypeError("A valid call id is required");
  }
  if (typeof claimToken !== "string" || claimToken.length < 16) {
    throw new TypeError("Invalid call cleanup token");
  }
  if (!Number.isSafeInteger(now)) throw new TypeError("Invalid call timing");
  const result = await redisClient.eval(FINALIZE_TIMED_OUT_CALL_SCRIPT, {
    keys: [
      callKey(callId),
      CALL_TIMEOUTS_KEY,
      callTimeoutClaimKey(callId),
    ],
    arguments: [
      callId,
      claimToken,
      String(now),
      CALL_USER_KEY_PREFIX,
      CALL_SOCKET_KEY_PREFIX,
    ],
  });
  const [status, callerId, callerSocketId, calleeId] = result || [];
  if (status === "STALE_CALL") return null;
  if (status !== "TIMED_OUT") {
    throw new CallStateError(
      status || "CALL_STATE_FAILED",
      "Could not finalize timed out call",
    );
  }
  return { callId, calleeId, callerId, callerSocketId };
};

const cleanupCallsForSocket = async ({
  userId,
  socketId,
  redisClient = redis,
}) => {
  if (typeof userId !== "string" || !USER_ID_PATTERN.test(userId)) {
    throw new TypeError("A valid call user is required");
  }
  if (
    typeof socketId !== "string" ||
    socketId.length === 0 ||
    socketId.length > 200
  ) {
    throw new TypeError("A valid call socket id is required");
  }
  const socketKey = callSocketKey(socketId);
  const callIds = await redisClient.sMembers(socketKey);
  const terminatedCalls = [];
  for (const callId of callIds) {
    try {
      terminatedCalls.push(
        await endCall({
          callId,
          actorId: userId,
          actorSocketId: socketId,
          redisClient,
        }),
      );
    } catch (error) {
      if (
        error instanceof CallStateError &&
        ["CALL_NOT_FOUND", "CALL_ACTION_DENIED"].includes(error.code)
      ) {
        await redisClient.sRem(socketKey, callId);
        continue;
      }
      throw error;
    }
  }
  return terminatedCalls;
};

module.exports = {
  ACCEPT_PENDING_CALL_SCRIPT,
  ACTIVE_CALL_TTL_MS,
  CALL_TIMEOUTS_KEY,
  CALL_STATE_RETENTION_MS,
  CALL_TIMEOUT_CLAIM_KEY_PREFIX,
  CREATE_PENDING_CALL_SCRIPT,
  CLAIM_TIMED_OUT_CALLS_SCRIPT,
  CallStateError,
  PENDING_CALL_TTL_MS,
  FINALIZE_TIMED_OUT_CALL_SCRIPT,
  TERMINATE_CALL_SCRIPT,
  acceptPendingCall,
  callKey,
  callSocketKey,
  callTimeoutClaimKey,
  callUserKey,
  cleanupCallsForSocket,
  createPendingCall,
  claimTimedOutCallIds,
  endCall,
  finalizeTimedOutCall,
  rejectPendingCall,
  terminateCall,
  validateCallIdentity,
  validateCallActionIdentity,
};
