const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { registerProcessFailureHandlers } = require("../service/processFailure.service");
const {
  getWorkerHealth,
  recordWorkerRun,
  recordWorkerStarted,
  recordWorkerStopped,
  resetWorkerHealth,
} = require("../service/workerHealth.service");

test("fatal process errors are logged and trigger shutdown only once", async () => {
  const processRef = new EventEmitter();
  processRef.exitCode = 0;
  const logs = [];
  const shutdowns = [];
  registerProcessFailureHandlers({
    processRef,
    logger: (...args) => logs.push(args),
    shutdown: async (...args) => shutdowns.push(args),
  });
  processRef.emit("unhandledRejection", new Error("secret failure"));
  processRef.emit("uncaughtException", new Error("later failure"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(shutdowns, [["unhandled_rejection", 1]]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1], "unhandled_rejection");
});

test("worker registry tracks lifecycle and failure recovery", () => {
  resetWorkerHealth();
  const startedAt = new Date("2026-09-03T00:00:00.000Z");
  const failedAt = new Date("2026-09-03T00:01:00.000Z");
  const recoveredAt = new Date("2026-09-03T00:02:00.000Z");
  recordWorkerStarted("worker", startedAt);
  recordWorkerRun("worker", false, failedAt);
  assert.equal(getWorkerHealth()[0].status, "degraded");
  assert.equal(getWorkerHealth()[0].failures, 1);
  recordWorkerRun("worker", true, recoveredAt);
  assert.equal(getWorkerHealth()[0].status, "running");
  assert.equal(getWorkerHealth()[0].lastSuccessAt, recoveredAt);
  recordWorkerStopped("worker", recoveredAt);
  assert.equal(getWorkerHealth()[0].status, "stopped");
});

test("all production workers report start, run and stop health", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const file of [
    "callTimeoutWorker.service.js",
    "presenceCleanupWorker.service.js",
    "pushNotificationQueue.service.js",
    "mediaCleanupJob.service.js",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, "../service", file), "utf8");
    assert.match(source, /recordWorkerStarted\(/);
    assert.match(source, /recordWorkerRun\([^,]+, true\)/);
    assert.match(source, /recordWorkerRun\([^,]+, false\)/);
    assert.match(source, /recordWorkerStopped\(/);
  }
});
