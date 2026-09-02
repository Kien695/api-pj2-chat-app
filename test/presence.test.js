const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CLAIM_EXPIRED_USERS_SCRIPT,
  FINALIZE_EXPIRED_USER_SCRIPT,
  LIST_ONLINE_USERS_SCRIPT,
  PRESENCE_REGISTRY_KEY,
  REMOVE_PRESENCE_SCRIPT,
  UPSERT_PRESENCE_SCRIPT,
  claimExpiredPresenceUserIds,
  finalizeExpiredPresence,
  listOnlineUserIds,
  presenceKey,
  presenceCleanupKey,
  removePresence,
  upsertPresence,
} = require("../service/presence.service");

const USER_ID = "507f1f77bcf86cd799439011";

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

test("registers one expiring socket atomically", async () => {
  const redisClient = createRedisRecorder(1);
  const count = await upsertPresence({
    userId: USER_ID,
    socketId: "socket-a",
    now: 1_000,
    ttlMs: 90_000,
    redisClient,
  });

  assert.equal(count, 1);
  assert.deepEqual(redisClient.calls[0], {
    script: UPSERT_PRESENCE_SCRIPT,
    options: {
      keys: [
        presenceKey(USER_ID),
        PRESENCE_REGISTRY_KEY,
        presenceCleanupKey(USER_ID),
      ],
      arguments: ["socket-a", "91000", "90000", USER_ID, "1000"],
    },
  });
  assert.match(UPSERT_PRESENCE_SCRIPT, /HDEL/);
  assert.match(UPSERT_PRESENCE_SCRIPT, /PEXPIRE/);
});

test("removes only one socket and preserves the latest remaining expiry", async () => {
  const redisClient = createRedisRecorder(2);
  const count = await removePresence({
    userId: USER_ID,
    socketId: "socket-a",
    now: 5_000,
    redisClient,
  });

  assert.equal(count, 2);
  assert.equal(redisClient.calls[0].script, REMOVE_PRESENCE_SCRIPT);
  assert.match(REMOVE_PRESENCE_SCRIPT, /maximumExpiry/);
  assert.match(REMOVE_PRESENCE_SCRIPT, /ZREM/);
});

test("lists only unexpired users without consuming cleanup candidates", async () => {
  const redisClient = createRedisRecorder([USER_ID]);
  const users = await listOnlineUserIds({ now: 10_000, redisClient });

  assert.deepEqual(users, [USER_ID]);
  assert.equal(redisClient.calls[0].script, LIST_ONLINE_USERS_SCRIPT);
  assert.match(LIST_ONLINE_USERS_SCRIPT, /ZRANGEBYSCORE/);
  assert.doesNotMatch(LIST_ONLINE_USERS_SCRIPT, /ZREM/);
});

test("atomically claims a bounded batch of expired users", async () => {
  const redisClient = createRedisRecorder([USER_ID]);
  const users = await claimExpiredPresenceUserIds({
    now: 100_000,
    limit: 25,
    claimToken: "cleanup-token-123456",
    claimTtlMs: 120_000,
    redisClient,
  });

  assert.deepEqual(users, [USER_ID]);
  assert.deepEqual(redisClient.calls[0], {
    script: CLAIM_EXPIRED_USERS_SCRIPT,
    options: {
      keys: [PRESENCE_REGISTRY_KEY],
      arguments: [
        "100000",
        "25",
        "presence:user:",
        "presence:cleanup:",
        "cleanup-token-123456",
        "120000",
      ],
    },
  });
  assert.match(CLAIM_EXPIRED_USERS_SCRIPT, /LIMIT/);
  assert.match(CLAIM_EXPIRED_USERS_SCRIPT, /"NX"/);
  assert.match(CLAIM_EXPIRED_USERS_SCRIPT, /DEL/);
});

test("finalizes offline only while its cleanup token still owns the user", async () => {
  const redisClient = createRedisRecorder(1);
  const finalized = await finalizeExpiredPresence({
    userId: USER_ID,
    claimToken: "cleanup-token-123456",
    now: 100_001,
    redisClient,
  });

  assert.equal(finalized, true);
  assert.deepEqual(redisClient.calls[0], {
    script: FINALIZE_EXPIRED_USER_SCRIPT,
    options: {
      keys: [PRESENCE_REGISTRY_KEY, presenceCleanupKey(USER_ID)],
      arguments: [USER_ID, "cleanup-token-123456", "100001"],
    },
  });
  assert.match(FINALIZE_EXPIRED_USER_SCRIPT, /ZSCORE/);
  assert.match(FINALIZE_EXPIRED_USER_SCRIPT, /ZREM/);
});

test("rejects an unsafe cleanup batch size", async () => {
  const redisClient = createRedisRecorder([]);
  await assert.rejects(
    claimExpiredPresenceUserIds({
      limit: 1_001,
      claimToken: "cleanup-token-123456",
      redisClient,
    }),
    /cleanup limit/,
  );
  assert.equal(redisClient.calls.length, 0);
});

test("rejects malformed identities and timing before accessing Redis", async () => {
  const redisClient = createRedisRecorder(0);

  await assert.rejects(
    upsertPresence({ userId: "bad", socketId: "socket-a", redisClient }),
    /valid user id/,
  );
  await assert.rejects(
    removePresence({ userId: USER_ID, socketId: "", redisClient }),
    /valid socket id/,
  );
  await assert.rejects(
    listOnlineUserIds({ now: Number.NaN, redisClient }),
    /presence timing/,
  );
  assert.equal(redisClient.calls.length, 0);
});

test("socket lifecycle registers, refreshes and removes distributed presence", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );

  assert.match(source, /await upsertPresence\(\{/);
  assert.match(source, /setInterval\(\(\) => \{/);
  assert.match(source, /clearInterval\(presenceHeartbeat\)/);
  assert.match(source, /await removePresence\(\{/);
  assert.match(source, /distributedSocketCount === 1/);
  assert.match(source, /distributedSocketCountAfterDisconnect === 0/);
  assert.match(source, /await listOnlineUserIds\(\)/);
});
