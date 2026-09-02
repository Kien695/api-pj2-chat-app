const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createPresenceCleanupScheduler,
  runPresenceCleanupBatch,
} = require("../service/presenceCleanupWorker.service");

const USER_ID = "507f1f77bcf86cd799439011";

const createFixture = ({ finalizeResult = 1, onlineExpiry = null } = {}) => {
  const emissions = [];
  const updates = [];
  const redisClient = {
    async eval(script) {
      if (script.includes("ZRANGEBYSCORE") && script.includes("LIMIT")) {
        return [USER_ID];
      }
      if (script.includes('redis.call("GET", KEYS[2])')) {
        return finalizeResult;
      }
      throw new Error("Unexpected script");
    },
    async zScore() {
      return onlineExpiry;
    },
  };
  return {
    emissions,
    updates,
    io: {
      emit(event, payload) {
        emissions.push({ event, payload });
      },
    },
    redisClient,
    userModel: {
      async updateOne(filter, update) {
        updates.push({ filter, update });
      },
    },
  };
};

test("marks and emits offline only after cleanup ownership is finalized", async () => {
  const fixture = createFixture();
  const result = await runPresenceCleanupBatch({
    ...fixture,
    now: 100_000,
    tokenFactory: () => "cleanup-token-123456",
  });

  assert.deepEqual(result, { claimed: 1, offline: 1, reconnected: 0 });
  assert.equal(fixture.updates.length, 1);
  assert.equal(fixture.updates[0].update.status, "offline");
  assert.equal(fixture.emissions[0].event, "SERVER_USER_OFFLINE");
  assert.equal(fixture.emissions[0].payload.userId, USER_ID);
});

test("does not emit offline and restores Mongo status after reconnect", async () => {
  const fixture = createFixture({
    finalizeResult: 0,
    onlineExpiry: Date.now() + 60_000,
  });
  const result = await runPresenceCleanupBatch({
    ...fixture,
    now: 100_000,
    tokenFactory: () => "cleanup-token-123456",
  });

  assert.deepEqual(result, { claimed: 1, offline: 0, reconnected: 1 });
  assert.deepEqual(
    fixture.updates.map(({ update }) => update.status),
    ["offline", "online"],
  );
  assert.equal(fixture.emissions.length, 0);
});

test("rejects an invalid Socket.IO dependency", async () => {
  await assert.rejects(
    runPresenceCleanupBatch({ io: {}, tokenFactory: () => "token" }),
    /Socket.IO server/,
  );
});

test("scheduler prevents overlapping cleanup batches and stops its timer", async () => {
  let releaseBatch;
  let runCalls = 0;
  let scheduledRun;
  let clearedTimer;
  const scheduler = createPresenceCleanupScheduler({
    io: { emit() {} },
    runBatch: async () => {
      runCalls += 1;
      await new Promise((resolve) => {
        releaseBatch = resolve;
      });
    },
    logger: { error() {} },
    setIntervalImpl(callback) {
      scheduledRun = callback;
      return { unref() {} };
    },
    clearIntervalImpl(timer) {
      clearedTimer = timer;
    },
  });

  scheduler.start();
  await Promise.resolve();
  assert.equal(await scheduledRun(), false);
  assert.equal(runCalls, 1);
  releaseBatch();
  await Promise.resolve();
  await scheduler.stop();
  assert.ok(clearedTimer);
});

test("server starts and stops the presence cleanup worker", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");

  assert.match(source, /startPresenceCleanupWorker\(getIO\(\)\)/);
  assert.match(source, /await stopPresenceCleanupWorker\(\)/);
});
