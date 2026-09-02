const redis = require("../config/redis");

const PRESENCE_REGISTRY_KEY = "presence:users";
const DEFAULT_PRESENCE_TTL_MS = 90_000;

const UPSERT_PRESENCE_SCRIPT = `
local entries = redis.call("HGETALL", KEYS[1])
for index = 1, #entries, 2 do
  if tonumber(entries[index + 1]) <= tonumber(ARGV[5]) then
    redis.call("HDEL", KEYS[1], entries[index])
  end
end
redis.call("HSET", KEYS[1], ARGV[1], ARGV[2])
redis.call("PEXPIRE", KEYS[1], ARGV[3])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[4])
redis.call("DEL", KEYS[3])
return redis.call("HLEN", KEYS[1])
`;

const REMOVE_PRESENCE_SCRIPT = `
redis.call("HDEL", KEYS[1], ARGV[1])
local entries = redis.call("HGETALL", KEYS[1])
local maximumExpiry = 0
for index = 1, #entries, 2 do
  local expiry = tonumber(entries[index + 1])
  if expiry <= tonumber(ARGV[3]) then
    redis.call("HDEL", KEYS[1], entries[index])
  elseif expiry > maximumExpiry then
    maximumExpiry = expiry
  end
end
local count = redis.call("HLEN", KEYS[1])
if count == 0 then
  redis.call("DEL", KEYS[1])
  redis.call("ZREM", KEYS[2], ARGV[2])
else
  redis.call("PEXPIRE", KEYS[1], maximumExpiry - tonumber(ARGV[3]))
  redis.call("ZADD", KEYS[2], maximumExpiry, ARGV[2])
end
return count
`;

const LIST_ONLINE_USERS_SCRIPT = `
return redis.call("ZRANGEBYSCORE", KEYS[1], ARGV[1], "+inf")
`;

const CLAIM_EXPIRED_USERS_SCRIPT = `
local candidates = redis.call(
  "ZRANGEBYSCORE",
  KEYS[1],
  "-inf",
  ARGV[1],
  "LIMIT",
  0,
  ARGV[2]
)
local claimed = {}
for _, userId in ipairs(candidates) do
  if redis.call("SET", ARGV[4] .. userId, ARGV[5], "NX", "PX", ARGV[6]) then
    redis.call("DEL", ARGV[3] .. userId)
    table.insert(claimed, userId)
  end
end
return claimed
`;

const FINALIZE_EXPIRED_USER_SCRIPT = `
if redis.call("GET", KEYS[2]) ~= ARGV[2] then
  return 0
end
local score = redis.call("ZSCORE", KEYS[1], ARGV[1])
if score and tonumber(score) > tonumber(ARGV[3]) then
  redis.call("DEL", KEYS[2])
  return 0
end
redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("DEL", KEYS[2])
return 1
`;

const validatePresenceIdentity = (userId, socketId) => {
  if (typeof userId !== "string" || !/^[a-f\d]{24}$/i.test(userId)) {
    throw new TypeError("A valid user id is required");
  }
  if (
    typeof socketId !== "string" ||
    socketId.length === 0 ||
    socketId.length > 200
  ) {
    throw new TypeError("A valid socket id is required");
  }
};

const presenceKey = (userId) => `presence:user:${userId}`;
const presenceCleanupKey = (userId) => `presence:cleanup:${userId}`;

const upsertPresence = async ({
  userId,
  socketId,
  now = Date.now(),
  ttlMs = DEFAULT_PRESENCE_TTL_MS,
  redisClient = redis,
}) => {
  validatePresenceIdentity(userId, socketId);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new TypeError("Invalid presence timing");
  }
  const expiresAt = now + ttlMs;
  return redisClient.eval(UPSERT_PRESENCE_SCRIPT, {
    keys: [
      presenceKey(userId),
      PRESENCE_REGISTRY_KEY,
      presenceCleanupKey(userId),
    ],
    arguments: [socketId, String(expiresAt), String(ttlMs), userId, String(now)],
  });
};

const removePresence = async ({
  userId,
  socketId,
  now = Date.now(),
  redisClient = redis,
}) => {
  validatePresenceIdentity(userId, socketId);
  if (!Number.isSafeInteger(now)) throw new TypeError("Invalid presence timing");
  return redisClient.eval(REMOVE_PRESENCE_SCRIPT, {
    keys: [presenceKey(userId), PRESENCE_REGISTRY_KEY],
    arguments: [socketId, userId, String(now)],
  });
};

const listOnlineUserIds = async ({
  now = Date.now(),
  redisClient = redis,
} = {}) => {
  if (!Number.isSafeInteger(now)) throw new TypeError("Invalid presence timing");
  return redisClient.eval(LIST_ONLINE_USERS_SCRIPT, {
    keys: [PRESENCE_REGISTRY_KEY],
    arguments: [String(now)],
  });
};

const claimExpiredPresenceUserIds = async ({
  now = Date.now(),
  limit = 100,
  claimToken,
  claimTtlMs = 120_000,
  redisClient = redis,
} = {}) => {
  if (!Number.isSafeInteger(now)) throw new TypeError("Invalid presence timing");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new TypeError("Invalid presence cleanup limit");
  }
  if (typeof claimToken !== "string" || claimToken.length < 16) {
    throw new TypeError("Invalid presence cleanup token");
  }
  if (!Number.isSafeInteger(claimTtlMs) || claimTtlMs < 1_000) {
    throw new TypeError("Invalid presence cleanup TTL");
  }
  return redisClient.eval(CLAIM_EXPIRED_USERS_SCRIPT, {
    keys: [PRESENCE_REGISTRY_KEY],
    arguments: [
      String(now),
      String(limit),
      "presence:user:",
      "presence:cleanup:",
      claimToken,
      String(claimTtlMs),
    ],
  });
};

const finalizeExpiredPresence = async ({
  userId,
  claimToken,
  now = Date.now(),
  redisClient = redis,
}) => {
  if (typeof userId !== "string" || !/^[a-f\d]{24}$/i.test(userId)) {
    throw new TypeError("A valid user id is required");
  }
  if (typeof claimToken !== "string" || claimToken.length < 16) {
    throw new TypeError("Invalid presence cleanup token");
  }
  if (!Number.isSafeInteger(now)) throw new TypeError("Invalid presence timing");
  const result = await redisClient.eval(FINALIZE_EXPIRED_USER_SCRIPT, {
    keys: [PRESENCE_REGISTRY_KEY, presenceCleanupKey(userId)],
    arguments: [userId, claimToken, String(now)],
  });
  return result === 1;
};

const isPresenceOnline = async ({
  userId,
  now = Date.now(),
  redisClient = redis,
}) => {
  if (typeof userId !== "string" || !/^[a-f\d]{24}$/i.test(userId)) {
    throw new TypeError("A valid user id is required");
  }
  if (!Number.isSafeInteger(now)) throw new TypeError("Invalid presence timing");
  const expiry = await redisClient.zScore(PRESENCE_REGISTRY_KEY, userId);
  return typeof expiry === "number" && expiry > now;
};

module.exports = {
  CLAIM_EXPIRED_USERS_SCRIPT,
  DEFAULT_PRESENCE_TTL_MS,
  FINALIZE_EXPIRED_USER_SCRIPT,
  LIST_ONLINE_USERS_SCRIPT,
  PRESENCE_REGISTRY_KEY,
  REMOVE_PRESENCE_SCRIPT,
  UPSERT_PRESENCE_SCRIPT,
  claimExpiredPresenceUserIds,
  finalizeExpiredPresence,
  isPresenceOnline,
  listOnlineUserIds,
  presenceKey,
  presenceCleanupKey,
  removePresence,
  upsertPresence,
  validatePresenceIdentity,
};
