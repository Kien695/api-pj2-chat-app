const { randomUUID } = require("node:crypto");
const {
  CallStateError,
  claimTimedOutCallIds,
  finalizeTimedOutCall,
} = require("./callState.service");
const {
  recordWorkerRun,
  recordWorkerStarted,
  recordWorkerStopped,
} = require("./workerHealth.service");

const CALL_TIMEOUT_WORKER_INTERVAL_MS = 5_000;

const runCallTimeoutBatch = async ({
  io,
  now = Date.now(),
  limit = 100,
  tokenFactory = randomUUID,
  logger = console,
  claimCalls = claimTimedOutCallIds,
  finalizeCall = finalizeTimedOutCall,
}) => {
  if (!io || typeof io.to !== "function") {
    throw new TypeError("A Socket.IO server is required");
  }
  const claimToken = tokenFactory();
  const callIds = await claimCalls({ now, limit, claimToken });
  const result = { claimed: callIds.length, timedOut: 0, skipped: 0 };

  for (const callId of callIds) {
    try {
      const call = await finalizeCall({
        callId,
        claimToken,
        now: Date.now(),
      });
      if (!call) {
        result.skipped += 1;
        continue;
      }
      io.to(call.callerSocketId).emit("callRejected", {
        callId,
        name: "Hệ thống",
        profilepic: "",
        reason: "timeout",
      });
      io.to(call.calleeId).emit("callEnded", {
        callId,
        by: "system",
        reason: "timeout",
      });
      result.timedOut += 1;
    } catch (error) {
      if (
        error instanceof CallStateError &&
        ["CALL_NOT_TIMED_OUT", "CLAIM_LOST"].includes(error.code)
      ) {
        result.skipped += 1;
        continue;
      }
      logger.error("Call timeout cleanup failed", { callId, error });
    }
  }
  return result;
};

const createCallTimeoutScheduler = ({
  io,
  intervalMs = CALL_TIMEOUT_WORKER_INTERVAL_MS,
  runBatch = runCallTimeoutBatch,
  logger = console,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
}) => {
  let timer = null;
  let activeRun = null;

  const run = () => {
    if (activeRun) return Promise.resolve(false);
    activeRun = (async () => {
      try {
        await runBatch({ io });
        recordWorkerRun("call_timeout", true);
        return true;
      } catch (error) {
        logger.error("Call timeout worker failed", error);
        recordWorkerRun("call_timeout", false);
        return false;
      } finally {
        activeRun = null;
      }
    })();
    return activeRun;
  };

  const start = () => {
    if (timer) return;
    void run();
    timer = setIntervalImpl(run, intervalMs);
    timer.unref?.();
  };

  const stop = async () => {
    if (timer) {
      clearIntervalImpl(timer);
      timer = null;
    }
    if (activeRun) await activeRun;
  };

  return { run, start, stop };
};

let callTimeoutScheduler = null;

const startCallTimeoutWorker = (io) => {
  if (callTimeoutScheduler) return;
  callTimeoutScheduler = createCallTimeoutScheduler({ io });
  callTimeoutScheduler.start();
  recordWorkerStarted("call_timeout");
};

const stopCallTimeoutWorker = async () => {
  if (!callTimeoutScheduler) return;
  await callTimeoutScheduler.stop();
  callTimeoutScheduler = null;
  recordWorkerStopped("call_timeout");
};

module.exports = {
  CALL_TIMEOUT_WORKER_INTERVAL_MS,
  createCallTimeoutScheduler,
  runCallTimeoutBatch,
  startCallTimeoutWorker,
  stopCallTimeoutWorker,
};
