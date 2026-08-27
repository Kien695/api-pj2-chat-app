const crypto = require("crypto");
const redis = require("../config/redis");

const RATE_LIMIT_SCRIPT = `
  local count = redis.call('INCRBY', KEYS[1], ARGV[2])
  if count == tonumber(ARGV[2]) then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  local ttl = redis.call('TTL', KEYS[1])
  return { tostring(count), tostring(ttl) }
`;

const fingerprintIdentifier = (identifier) =>
  crypto
    .createHmac("sha256", process.env.JWT_ACCESS_TOKEN || "rate-limit-key")
    .update(String(identifier))
    .digest("hex");

const consumeRateLimit = async (
  { policy, identifier, limit, windowSeconds, cost = 1 },
  redisClient = redis,
) => {
  const key = `rate-limit:${policy}:${fingerprintIdentifier(identifier)}`;
  const result = await redisClient.eval(RATE_LIMIT_SCRIPT, {
    keys: [key],
    arguments: [String(windowSeconds), String(cost)],
  });
  const count = Number(result[0]);
  const ttl = Math.max(1, Number(result[1]) || windowSeconds);
  return {
    allowed: count <= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: ttl,
  };
};

module.exports = { consumeRateLimit, fingerprintIdentifier };
