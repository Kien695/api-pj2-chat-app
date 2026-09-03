const assert = require("node:assert/strict");
const test = require("node:test");
const {
  checkReadiness,
  withTimeout,
} = require("../service/healthCheck.service");

const healthyMongo = {
  connection: {
    readyState: 1,
    db: { admin: () => ({ ping: async () => ({ ok: 1 }) }) },
  },
};
const healthyRedis = { isReady: true, ping: async () => "PONG" };

test("readiness succeeds only when MongoDB and Redis respond", async () => {
  assert.deepEqual(
    await checkReadiness({ database: healthyMongo, redisClient: healthyRedis }),
    { ready: true, checks: { mongo: true, redis: true } },
  );
  assert.deepEqual(
    await checkReadiness({
      database: { connection: { readyState: 0 } },
      redisClient: healthyRedis,
    }),
    { ready: false, checks: { mongo: false, redis: true } },
  );
});

test("readiness fails closed on dependency errors and shutdown", async () => {
  const brokenRedis = {
    isReady: true,
    ping: async () => { throw new Error("connection details must not escape"); },
  };
  assert.deepEqual(
    await checkReadiness({ database: healthyMongo, redisClient: brokenRedis }),
    { ready: false, checks: { mongo: true, redis: false } },
  );
  assert.deepEqual(
    await checkReadiness({
      database: healthyMongo,
      redisClient: healthyRedis,
      isShuttingDown: () => true,
    }),
    { ready: false, checks: { mongo: false, redis: false } },
  );
});

test("dependency checks have a bounded timeout", async () => {
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), 5),
    /timed out/,
  );
});

test("health routes are public, minimal and registered before API routes", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const router = fs.readFileSync(path.join(__dirname, "../router/index.router.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "../controller/health.controller.js"), "utf8");
  assert.ok(router.indexOf('app.use("/health"') < router.indexOf('app.use("/auth"'));
  assert.doesNotMatch(controller, /process\.env|connectionString|stack|error\.message/);
});
