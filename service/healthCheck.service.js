const mongoose = require("mongoose");
const redis = require("../config/redis");

const HEALTH_CHECK_TIMEOUT_MS = 1_000;
let shuttingDown = false;

const setShuttingDown = (value) => {
  shuttingDown = value === true;
};

const withTimeout = async (operation, timeoutMs = HEALTH_CHECK_TIMEOUT_MS) => {
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Health check timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const checkMongo = async (database) => {
  if (database.connection?.readyState !== 1) return false;
  try {
    await withTimeout(() => database.connection.db.admin().ping());
    return true;
  } catch {
    return false;
  }
};

const checkRedis = async (redisClient) => {
  if (redisClient.isReady !== true) return false;
  try {
    return (await withTimeout(() => redisClient.ping())) === "PONG";
  } catch {
    return false;
  }
};

const checkReadiness = async ({
  database = mongoose,
  redisClient = redis,
  isShuttingDown = () => shuttingDown,
} = {}) => {
  if (isShuttingDown()) {
    return { ready: false, checks: { mongo: false, redis: false } };
  }
  const [mongo, redisReady] = await Promise.all([
    checkMongo(database),
    checkRedis(redisClient),
  ]);
  return {
    ready: mongo && redisReady,
    checks: { mongo, redis: redisReady },
  };
};

module.exports = {
  HEALTH_CHECK_TIMEOUT_MS,
  checkReadiness,
  setShuttingDown,
  withTimeout,
};
