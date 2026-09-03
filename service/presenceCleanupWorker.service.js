const { randomUUID } = require("node:crypto");
const User = require("../model/user.model");
const redis = require("../config/redis");
const {
  claimExpiredPresenceUserIds,
  finalizeExpiredPresence,
  isPresenceOnline,
} = require("./presence.service");
const {
  recordWorkerRun,
  recordWorkerStarted,
  recordWorkerStopped,
} = require("./workerHealth.service");

const PRESENCE_CLEANUP_INTERVAL_MS = 30_000;

const runPresenceCleanupBatch = async ({
  io,
  now = Date.now(),
  limit = 100,
  redisClient = redis,
  userModel = User,
  tokenFactory = randomUUID,
}) => {
  if (!io || typeof io.emit !== "function") {
    throw new TypeError("A Socket.IO server is required");
  }
  const claimToken = tokenFactory();
  const userIds = await claimExpiredPresenceUserIds({
    now,
    limit,
    claimToken,
    redisClient,
  });
  const result = { claimed: userIds.length, offline: 0, reconnected: 0 };

  for (const userId of userIds) {
    const lastActive = new Date(now);
    await userModel.updateOne(
      { _id: userId },
      { status: "offline", lastActive },
    );
    const finalized = await finalizeExpiredPresence({
      userId,
      claimToken,
      now: Date.now(),
      redisClient,
    });
    if (finalized) {
      io.emit("SERVER_USER_OFFLINE", { userId, lastActive });
      result.offline += 1;
      continue;
    }

    if (await isPresenceOnline({ userId, now: Date.now(), redisClient })) {
      await userModel.updateOne({ _id: userId }, { status: "online" });
      result.reconnected += 1;
    }
  }

  return result;
};

const createPresenceCleanupScheduler = ({
  io,
  intervalMs = PRESENCE_CLEANUP_INTERVAL_MS,
  runBatch = runPresenceCleanupBatch,
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
        recordWorkerRun("presence_cleanup", true);
        return true;
      } catch (error) {
        logger.error("Presence cleanup worker failed", error);
        recordWorkerRun("presence_cleanup", false);
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

let presenceCleanupScheduler = null;

const startPresenceCleanupWorker = (io) => {
  if (presenceCleanupScheduler) return;
  presenceCleanupScheduler = createPresenceCleanupScheduler({ io });
  presenceCleanupScheduler.start();
  recordWorkerStarted("presence_cleanup");
};

const stopPresenceCleanupWorker = async () => {
  if (!presenceCleanupScheduler) return;
  await presenceCleanupScheduler.stop();
  presenceCleanupScheduler = null;
  recordWorkerStopped("presence_cleanup");
};

module.exports = {
  PRESENCE_CLEANUP_INTERVAL_MS,
  createPresenceCleanupScheduler,
  runPresenceCleanupBatch,
  startPresenceCleanupWorker,
  stopPresenceCleanupWorker,
};
