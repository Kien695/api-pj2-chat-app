const { consumeRateLimit } = require("./rateLimit.service");

const SOCKET_RATE_LIMITS = Object.freeze({
  message: { limit: 40, windowSeconds: 10 },
  typing: { limit: 30, windowSeconds: 10 },
  callStart: { limit: 5, windowSeconds: 60 },
  callAction: { limit: 30, windowSeconds: 60 },
});

class SocketRateLimitError extends Error {
  constructor(policy, retryAfterSeconds) {
    super("Bạn thao tác quá nhiều lần, vui lòng thử lại sau");
    this.name = "SocketRateLimitError";
    this.code = "SOCKET_RATE_LIMIT_EXCEEDED";
    this.policy = policy;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const enforceSocketRateLimit = async (
  policy,
  userId,
  cost = 1,
  consume = consumeRateLimit,
) => {
  const options = SOCKET_RATE_LIMITS[policy];
  if (!options || !userId) throw new TypeError("Invalid socket rate-limit policy");

  try {
    const result = await consume({
      policy: `socket:${policy}`,
      identifier: `user:${userId}`,
      cost,
      ...options,
    });
    if (!result.allowed) {
      throw new SocketRateLimitError(policy, result.retryAfterSeconds);
    }
    return result;
  } catch (error) {
    if (error instanceof SocketRateLimitError) throw error;
    console.error(`Socket rate limiter unavailable: ${policy}`, error?.message);
    return { allowed: true, degraded: true };
  }
};

module.exports = {
  SOCKET_RATE_LIMITS,
  SocketRateLimitError,
  enforceSocketRateLimit,
};
