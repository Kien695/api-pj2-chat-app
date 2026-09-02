const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  createCallTimeoutScheduler,
  runCallTimeoutBatch,
} = require("../service/callTimeoutWorker.service");

const CALL_ID = "123e4567-e89b-42d3-a456-426614174000";
const CALLEE_ID = "507f1f77bcf86cd799439012";

test("timeout worker notifies caller and every callee device", async () => {
  const emissions = [];
  const io = {
    to(target) {
      return {
        emit(event, payload) {
          emissions.push({ target, event, payload });
        },
      };
    },
  };
  const result = await runCallTimeoutBatch({
    io,
    now: 70_000,
    tokenFactory: () => "timeout-token-123456",
    claimCalls: async () => [CALL_ID],
    finalizeCall: async () => ({
      callId: CALL_ID,
      callerSocketId: "caller-socket",
      calleeId: CALLEE_ID,
    }),
  });

  assert.deepEqual(result, { claimed: 1, timedOut: 1, skipped: 0 });
  assert.deepEqual(
    emissions.map(({ target, event }) => ({ target, event })),
    [
      { target: "caller-socket", event: "callRejected" },
      { target: CALLEE_ID, event: "callEnded" },
    ],
  );
});

test("scheduler prevents overlapping batches and waits during stop", async () => {
  let release;
  let scheduledRun;
  let calls = 0;
  const scheduler = createCallTimeoutScheduler({
    io: { to() {} },
    runBatch: async () => {
      calls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    logger: { error() {} },
    setIntervalImpl(callback) {
      scheduledRun = callback;
      return { unref() {} };
    },
    clearIntervalImpl() {},
  });

  scheduler.start();
  await Promise.resolve();
  assert.equal(await scheduledRun(), false);
  assert.equal(calls, 1);
  release();
  await scheduler.stop();
});

test("server starts and stops the call timeout worker", () => {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.match(source, /startCallTimeoutWorker\(getIO\(\)\)/);
  assert.match(source, /await stopCallTimeoutWorker\(\)/);
});
