const { consumeRateLimit } = require("../service/rateLimit.service");

const AUTH_RATE_LIMITS = Object.freeze({
  register: { limit: 5, windowSeconds: 60 * 60 },
  login: { limit: 10, windowSeconds: 15 * 60 },
  verifyEmail: { limit: 10, windowSeconds: 15 * 60 },
  forgotPassword: { limit: 5, windowSeconds: 15 * 60 },
  verifyForgotPassword: { limit: 10, windowSeconds: 15 * 60 },
  resetPassword: { limit: 5, windowSeconds: 15 * 60 },
  refreshToken: { limit: 30, windowSeconds: 60 },
  changePassword: { limit: 10, windowSeconds: 60 * 60 },
  passkey: { limit: 10, windowSeconds: 15 * 60 },
  oauthStart: { limit: 20, windowSeconds: 15 * 60 },
  oauthExchange: { limit: 10, windowSeconds: 5 * 60 },
  qrCreate: { limit: 10, windowSeconds: 5 * 60 },
  qrAction: { limit: 20, windowSeconds: 5 * 60 },
});

const REST_RATE_LIMITS = Object.freeze({
  userSearch: { limit: 60, windowSeconds: 60 },
  profileUpload: { limit: 10, windowSeconds: 10 * 60 },
  chatUpload: { limit: 30, windowSeconds: 10 * 60 },
  chatSync: { limit: 120, windowSeconds: 60 },
  messageSearch: { limit: 60, windowSeconds: 60 },
  pushSubscription: { limit: 30, windowSeconds: 10 * 60 },
  sessionManagement: { limit: 30, windowSeconds: 10 * 60 },
  roomCreate: { limit: 20, windowSeconds: 60 * 60 },
  roomMutation: { limit: 60, windowSeconds: 10 * 60 },
});

const getRequestIdentifier = (req) =>
  req.ip || req.socket?.remoteAddress || "unknown";

const getAuthenticatedRequestIdentifier = (req, res) =>
  res.locals?.userId
    ? `user:${res.locals.userId}`
    : `ip:${getRequestIdentifier(req)}`;

const createRateLimiter = (policy, options, consume = consumeRateLimit) => {
  if (!policy || !options?.limit || !options?.windowSeconds) {
    throw new TypeError("Invalid rate-limit policy");
  }
  return async function rateLimitMiddleware(req, res, next) {
    try {
      const identifier = options.getIdentifier
        ? options.getIdentifier(req, res)
        : getRequestIdentifier(req);
      const result = await consume({
        policy,
        identifier,
        limit: options.limit,
        windowSeconds: options.windowSeconds,
      });
      res.setHeader("RateLimit-Limit", String(result.limit));
      res.setHeader("RateLimit-Remaining", String(result.remaining));
      res.setHeader("RateLimit-Reset", String(result.retryAfterSeconds));
      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds));
        return res.status(429).json({
          success: false,
          error: true,
          code: "RATE_LIMIT_EXCEEDED",
          message: "Bạn thao tác quá nhiều lần, vui lòng thử lại sau",
        });
      }
      return next();
    } catch (error) {
      console.error(`Rate limiter unavailable: ${policy}`, error?.message);
      return next();
    }
  };
};

const authRateLimit = (policy) =>
  createRateLimiter(policy, AUTH_RATE_LIMITS[policy]);

const restRateLimit = (policy) =>
  createRateLimiter(policy, {
    ...REST_RATE_LIMITS[policy],
    getIdentifier: getAuthenticatedRequestIdentifier,
  });

module.exports = {
  AUTH_RATE_LIMITS,
  REST_RATE_LIMITS,
  authRateLimit,
  createRateLimiter,
  getAuthenticatedRequestIdentifier,
  getRequestIdentifier,
  restRateLimit,
};
