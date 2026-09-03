const { randomUUID } = require("node:crypto");
const redis = require("../config/redis");
const {
  notifyIncomingCall,
  notifyMessageRecipients,
} = require("./pushNotification.service");
const {
  recordWorkerRun,
  recordWorkerStarted,
  recordWorkerStopped,
} = require("./workerHealth.service");

const PUSH_JOB_HASH = "push:jobs";
const PUSH_SCHEDULED_KEY = "push:scheduled";
const PUSH_PROCESSING_KEY = "push:processing";
const PUSH_CLAIM_HASH = "push:claims";
const PUSH_WORKER_INTERVAL_MS = 5_000;
const PUSH_JOB_LEASE_MS = 30_000;
const MAX_PUSH_ATTEMPTS = 5;

const CLAIM_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 100)
for _, jobId in ipairs(expired) do
  redis.call('ZREM', KEYS[2], jobId)
  redis.call('HDEL', KEYS[4], jobId)
  redis.call('ZADD', KEYS[1], ARGV[1], jobId)
end
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #due == 0 then return {} end
local jobId = due[1]
local payload = redis.call('HGET', KEYS[3], jobId)
redis.call('ZREM', KEYS[1], jobId)
if not payload then return {} end
redis.call('ZADD', KEYS[2], ARGV[2], jobId)
redis.call('HSET', KEYS[4], jobId, ARGV[3])
return { jobId, payload }
`;

const FINALIZE_SCRIPT = `
if redis.call('HGET', KEYS[3], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
return 1
`;

const RETRY_SCRIPT = `
if redis.call('HGET', KEYS[4], ARGV[1]) ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[3], ARGV[1], ARGV[4])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HDEL', KEYS[4], ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
return 1
`;

const enqueueMessagePush = async (
  { room, message, sender },
  redisClient = redis,
  triggerWorker = triggerPushNotificationWorker,
) => {
  const jobId = `message:${message._id}`;
  const job = {
    jobId,
    attempts: 0,
    room: {
      _id: room._id.toString(),
      users: room.users.map((member) => ({ user_id: member.user_id.toString() })),
    },
    message: { _id: message._id.toString(), type: message.type },
    sender: { _id: sender._id.toString(), name: sender.name },
  };
  await redisClient
    .multi()
    .hSet(PUSH_JOB_HASH, jobId, JSON.stringify(job))
    .zAdd(PUSH_SCHEDULED_KEY, { score: Date.now(), value: jobId })
    .exec();
  void triggerWorker();
  return jobId;
};

const enqueueIncomingCallPush = async (
  { calleeId, callId, caller, type },
  redisClient = redis,
  triggerWorker = triggerPushNotificationWorker,
) => {
  const jobId = `call:${callId}`;
  const job = {
    jobId,
    kind: "incoming-call",
    attempts: 0,
    expiresAt: Date.now() + 30_000,
    calleeId: calleeId.toString(),
    callId,
    caller: { _id: caller._id.toString(), name: caller.name },
    type,
  };
  await redisClient
    .multi()
    .hSet(PUSH_JOB_HASH, jobId, JSON.stringify(job))
    .zAdd(PUSH_SCHEDULED_KEY, { score: Date.now(), value: jobId })
    .exec();
  void triggerWorker();
  return jobId;
};

const claimPushJob = async ({ redisClient = redis, now = Date.now(), claimToken }) => {
  const response = await redisClient.eval(CLAIM_SCRIPT, {
    keys: [PUSH_SCHEDULED_KEY, PUSH_PROCESSING_KEY, PUSH_JOB_HASH, PUSH_CLAIM_HASH],
    arguments: [String(now), String(now + PUSH_JOB_LEASE_MS), claimToken],
  });
  if (!response?.length) return null;
  try {
    return JSON.parse(response[1]);
  } catch {
    await redisClient.eval(FINALIZE_SCRIPT, {
      keys: [PUSH_PROCESSING_KEY, PUSH_JOB_HASH, PUSH_CLAIM_HASH],
      arguments: [response[0], claimToken],
    });
    return null;
  }
};

const processNextPushJob = async ({
  redisClient = redis,
  notify = notifyMessageRecipients,
  tokenFactory = randomUUID,
  now = Date.now(),
  logger = console,
} = {}) => {
  const claimToken = tokenFactory();
  const job = await claimPushJob({ redisClient, now, claimToken });
  if (!job) return false;

  let result;
  try {
    if (job.expiresAt && now >= job.expiresAt) {
      result = { retryableFailed: 0 };
    } else {
      const notificationHandler =
        job.kind === "incoming-call" ? notifyIncomingCall : notify;
      result = await notificationHandler(job);
    }
  } catch (error) {
    logger.error("Push notification job failed", { jobId: job.jobId, error });
    result = { retryableFailed: 1 };
  }
  const nextAttempts = job.attempts + 1;
  if (result.retryableFailed > 0 && nextAttempts < MAX_PUSH_ATTEMPTS) {
    const retryAt = now + Math.min(60_000, 2 ** nextAttempts * 1_000);
    await redisClient.eval(RETRY_SCRIPT, {
      keys: [PUSH_SCHEDULED_KEY, PUSH_PROCESSING_KEY, PUSH_JOB_HASH, PUSH_CLAIM_HASH],
      arguments: [job.jobId, claimToken, String(retryAt), JSON.stringify({ ...job, attempts: nextAttempts })],
    });
    return true;
  }

  await redisClient.eval(FINALIZE_SCRIPT, {
    keys: [PUSH_PROCESSING_KEY, PUSH_JOB_HASH, PUSH_CLAIM_HASH],
    arguments: [job.jobId, claimToken],
  });
  return true;
};

const drainPushJobs = async (limit = 20) => {
  for (let index = 0; index < limit; index += 1) {
    if (!(await processNextPushJob())) break;
  }
};

const createPushNotificationScheduler = ({
  runDrain = drainPushJobs,
  intervalMs = PUSH_WORKER_INTERVAL_MS,
  logger = console,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) => {
  let timer = null;
  let activeRun = null;
  const run = () => {
    if (activeRun) return Promise.resolve(false);
    activeRun = runDrain()
      .then(() => {
        recordWorkerRun("push_notification", true);
        return true;
      })
      .catch((error) => {
        logger.error("Push notification worker failed", error);
        recordWorkerRun("push_notification", false);
        return false;
      })
      .finally(() => { activeRun = null; });
    return activeRun;
  };
  const start = () => {
    if (timer) return;
    void run();
    timer = setIntervalImpl(run, intervalMs);
    timer.unref?.();
  };
  const stop = async () => {
    if (timer) clearIntervalImpl(timer);
    timer = null;
    if (activeRun) await activeRun;
  };
  return { run, start, stop };
};

let scheduler = null;
const getScheduler = () => {
  if (!scheduler) scheduler = createPushNotificationScheduler();
  return scheduler;
};
const triggerPushNotificationWorker = () => getScheduler().run();
const startPushNotificationWorker = () => {
  getScheduler().start();
  recordWorkerStarted("push_notification");
};
const stopPushNotificationWorker = async () => {
  if (!scheduler) return;
  await scheduler.stop();
  scheduler = null;
  recordWorkerStopped("push_notification");
};

module.exports = {
  CLAIM_SCRIPT,
  FINALIZE_SCRIPT,
  MAX_PUSH_ATTEMPTS,
  RETRY_SCRIPT,
  claimPushJob,
  createPushNotificationScheduler,
  drainPushJobs,
  enqueueMessagePush,
  enqueueIncomingCallPush,
  processNextPushJob,
  startPushNotificationWorker,
  stopPushNotificationWorker,
};
