const assert = require("node:assert/strict");
const test = require("node:test");
const {
  consumeRateLimit,
  fingerprintIdentifier,
} = require("../service/rateLimit.service");
const {
  AUTH_RATE_LIMITS,
  REST_RATE_LIMITS,
  createRateLimiter,
  getAuthenticatedRequestIdentifier,
} = require("../middleware/rateLimit.middleware");

test("uses a hashed identifier and an atomic Redis counter", async () => {
  const ip = "203.0.113.10";
  assert.equal(fingerprintIdentifier(ip).includes(ip), false);
  let invocation;
  const redis = {
    eval: async (script, options) => {
      invocation = { script, options };
      return ["3", "42"];
    },
  };
  const result = await consumeRateLimit({
    policy: "login",
    identifier: ip,
    limit: 10,
    windowSeconds: 900,
  }, redis);
  assert.equal(invocation.options.keys[0].startsWith("rate-limit:login:"), true);
  assert.equal(invocation.options.keys[0].includes(ip), false);
  assert.deepEqual(invocation.options.arguments, ["900", "1"]);
  assert.match(invocation.script, /INCRBY/);
  assert.deepEqual(result, {
    allowed: true,
    count: 3,
    limit: 10,
    remaining: 7,
    retryAfterSeconds: 42,
  });
});

test("returns 429 with Retry-After when a policy is exceeded", async () => {
  const headers = {};
  let statusCode;
  let body;
  const req = { ip: "198.51.100.20" };
  const res = {
    setHeader(name, value) { headers[name] = value; },
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  const limiter = createRateLimiter(
    "test",
    { limit: 2, windowSeconds: 60 },
    async () => ({
      allowed: false,
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 30,
    }),
  );
  await limiter(req, res, () => assert.fail("must not continue"));
  assert.equal(statusCode, 429);
  assert.equal(headers["Retry-After"], "30");
  assert.equal(body.code, "RATE_LIMIT_EXCEEDED");
});

test("fails open when Redis is unavailable", async () => {
  let nextCalled = false;
  const limiter = createRateLimiter(
    "test",
    { limit: 1, windowSeconds: 60 },
    async () => { throw new Error("Redis unavailable"); },
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    await limiter(
      { ip: "192.0.2.1" },
      { setHeader() {} },
      () => { nextCalled = true; },
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(nextCalled, true);
});

test("defines stricter account recovery limits than token refresh", () => {
  assert.ok(AUTH_RATE_LIMITS.forgotPassword.limit < AUTH_RATE_LIMITS.refreshToken.limit);
  assert.ok(AUTH_RATE_LIMITS.resetPassword.limit < AUTH_RATE_LIMITS.refreshToken.limit);
});

test("uses the authenticated user id for protected REST limits", () => {
  const identifier = getAuthenticatedRequestIdentifier(
    { ip: "203.0.113.10" },
    { locals: { userId: "507f1f77bcf86cd799439011" } },
  );
  assert.equal(identifier, "user:507f1f77bcf86cd799439011");
});

test("defines bounded policies for searches, uploads and room mutations", () => {
  assert.equal(REST_RATE_LIMITS.userSearch.limit, 60);
  assert.equal(REST_RATE_LIMITS.profileUpload.limit, 10);
  assert.equal(REST_RATE_LIMITS.chatUpload.limit, 30);
  assert.equal(REST_RATE_LIMITS.chatSync.limit, 120);
  assert.equal(REST_RATE_LIMITS.roomCreate.limit, 20);
  assert.equal(REST_RATE_LIMITS.roomMutation.limit, 60);
});
