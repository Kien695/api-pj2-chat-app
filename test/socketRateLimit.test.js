const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  SOCKET_RATE_LIMITS,
  SocketRateLimitError,
  enforceSocketRateLimit,
} = require("../service/socketRateLimit.service");

test("shares a socket quota by authenticated user and supports event cost", async () => {
  let input;
  await enforceSocketRateLimit("message", "user-1", 3, async (value) => {
    input = value;
    return { allowed: true, remaining: 37, retryAfterSeconds: 10 };
  });
  assert.deepEqual(input, {
    policy: "socket:message",
    identifier: "user:user-1",
    cost: 3,
    ...SOCKET_RATE_LIMITS.message,
  });
});

test("throws a stable socket error when quota is exceeded", async () => {
  await assert.rejects(
    enforceSocketRateLimit("typing", "user-1", 1, async () => ({
      allowed: false,
      retryAfterSeconds: 8,
    })),
    (error) =>
      error instanceof SocketRateLimitError &&
      error.code === "SOCKET_RATE_LIMIT_EXCEEDED" &&
      error.retryAfterSeconds === 8,
  );
});

test("fails open when Redis is unavailable", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await enforceSocketRateLimit(
      "callStart",
      "user-1",
      1,
      async () => {
        throw new Error("Redis unavailable");
      },
    );
    assert.equal(result.degraded, true);
  } finally {
    console.error = originalError;
  }
});

test("guards message, typing and call events in the socket server", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../socket/index.js"),
    "utf8",
  );
  assert.match(source, /enforceSocketRateLimit\("message", userId, roomIds\.length\)/);
  assert.match(source, /enforceSocketRateLimit\("typing", userId\)/);
  assert.match(source, /enforceSocketRateLimit\("callStart", userId\)/);
  assert.equal(
    source.match(/enforceSocketRateLimit\("callAction", userId\)/g)?.length,
    3,
  );
});
