const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  CLAIM_SCRIPT,
  FINALIZE_SCRIPT,
  RETRY_SCRIPT,
  createPushNotificationScheduler,
  enqueueIncomingCallPush,
  enqueueMessagePush,
  processNextPushJob,
} = require("../service/pushNotificationQueue.service");

const job = {
  jobId: "message:message-1",
  attempts: 0,
  room: { _id: "room-1", users: [{ user_id: "sender" }, { user_id: "recipient" }] },
  message: { _id: "message-1", type: "text" },
  sender: { _id: "sender", name: "Alice" },
};

test("enqueues a content-free message push job atomically", async () => {
  const operations = [];
  const transaction = {
    hSet(...args) { operations.push(["hSet", ...args]); return this; },
    zAdd(...args) { operations.push(["zAdd", ...args]); return this; },
    async exec() { operations.push(["exec"]); },
  };
  await enqueueMessagePush(
    {
      room: { _id: "room-1", users: [{ user_id: "sender" }, { user_id: "recipient" }] },
      message: { _id: "message-1", type: "text", content: "secret" },
      sender: { _id: "sender", name: "Alice" },
    },
    { multi() { return transaction; } },
    async () => {},
  );
  const stored = JSON.parse(operations[0][3]);
  assert.equal(stored.message.content, undefined);
  assert.equal(stored.jobId, "message:message-1");
  assert.equal(operations.at(-1)[0], "exec");
});

test("enqueues a short-lived call job without WebRTC signal", async () => {
  let serializedJob;
  const transaction = {
    hSet(key, id, value) { serializedJob = value; return this; },
    zAdd() { return this; },
    async exec() {},
  };
  await enqueueIncomingCallPush(
    {
      calleeId: "recipient",
      callId: "call-1",
      caller: { _id: "sender", name: "Alice" },
      type: "audio",
      signal: { secret: true },
    },
    { multi() { return transaction; } },
    async () => {},
  );
  const stored = JSON.parse(serializedJob);
  assert.equal(stored.kind, "incoming-call");
  assert.equal(stored.signal, undefined);
  assert.ok(stored.expiresAt > Date.now());
});

test("claims with a lease and finalizes a successful job by ownership token", async () => {
  const calls = [];
  const redisClient = {
    async eval(script, options) {
      calls.push({ script, options });
      if (script === CLAIM_SCRIPT) return [job.jobId, JSON.stringify(job)];
      if (script === FINALIZE_SCRIPT) return 1;
      return 0;
    },
  };
  assert.equal(
    await processNextPushJob({
      redisClient,
      notify: async () => ({ retryableFailed: 0 }),
      tokenFactory: () => "claim-token",
      now: 1000,
    }),
    true,
  );
  assert.equal(calls[0].script, CLAIM_SCRIPT);
  assert.equal(calls[1].script, FINALIZE_SCRIPT);
  assert.deepEqual(calls[1].options.arguments, [job.jobId, "claim-token"]);
});

test("retries transient failures with incremented attempts and bounded backoff", async () => {
  const calls = [];
  const redisClient = {
    async eval(script, options) {
      calls.push({ script, options });
      if (script === CLAIM_SCRIPT) return [job.jobId, JSON.stringify(job)];
      return 1;
    },
  };
  await processNextPushJob({
    redisClient,
    notify: async () => ({ retryableFailed: 1 }),
    tokenFactory: () => "claim-token",
    now: 1000,
  });
  assert.equal(calls[1].script, RETRY_SCRIPT);
  assert.equal(JSON.parse(calls[1].options.arguments[3]).attempts, 1);
  assert.ok(Number(calls[1].options.arguments[2]) > 1000);
});

test("scheduler prevents overlapping work and waits for active work during stop", async () => {
  let finish;
  let intervals = 0;
  const scheduler = createPushNotificationScheduler({
    runDrain: () => new Promise((resolve) => { finish = resolve; }),
    setIntervalImpl() { intervals += 1; return { unref() {} }; },
    clearIntervalImpl() { intervals -= 1; },
  });
  scheduler.start();
  assert.equal(intervals, 1);
  assert.equal(await scheduler.run(), false);
  const stopping = scheduler.stop();
  finish();
  await stopping;
  assert.equal(intervals, 0);
});

test("server starts and stops the push worker before Redis shutdown", () => {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.match(source, /startPushNotificationWorker\(\)/);
  assert.match(source, /await stopPushNotificationWorker\(\)/);
  assert.ok(source.indexOf("await stopPushNotificationWorker()") < source.indexOf("await shutdownServices"));
});
