const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
  createRequestObservabilityMiddleware,
} = require("../middleware/requestObservability.middleware");
const {
  REDACTED,
  sanitizeLogValue,
} = require("../utils/structuredLogger");

test("uses a safe incoming request id and logs a query-free completion record", () => {
  const req = {
    headers: { "x-request-id": "request_12345678" },
    method: "GET",
    originalUrl: "/auth/callback?code=secret-code",
  };
  const res = new EventEmitter();
  res.locals = {};
  res.statusCode = 200;
  res.setHeader = (name, value) => { res.header = { name, value }; };
  const logs = [];
  const metrics = [];
  const times = [100, 125];
  let nextCalled = false;
  createRequestObservabilityMiddleware({
    now: () => times.shift(),
    logger: (...args) => logs.push(args),
    recordRequest: (completion) => metrics.push(completion),
  })(req, res, () => { nextCalled = true; });
  res.emit("finish");

  assert.equal(nextCalled, true);
  assert.equal(req.id, "request_12345678");
  assert.deepEqual(res.header, { name: "X-Request-ID", value: "request_12345678" });
  assert.equal(logs[0][2].route, "/auth/callback");
  assert.equal(logs[0][2].durationMs, 25);
  assert.deepEqual(metrics, [logs[0][2]]);
  assert.equal(JSON.stringify(logs).includes("secret-code"), false);
});

test("rejects unsafe request ids and never logs request bodies", () => {
  const req = {
    headers: { "x-request-id": "bad\r\ninjected" },
    method: "POST",
    originalUrl: "/auth/login",
    body: { password: "Password@1" },
  };
  const res = new EventEmitter();
  res.locals = {};
  res.statusCode = 401;
  res.setHeader = (_name, value) => { res.requestId = value; };
  const logs = [];
  createRequestObservabilityMiddleware({
    createId: () => "generated-safe-id",
    logger: (...args) => logs.push(args),
    recordRequest: () => {},
  })(req, res, () => {});
  res.emit("finish");
  assert.equal(res.requestId, "generated-safe-id");
  assert.equal(JSON.stringify(logs).includes("Password@1"), false);
});

test("structured logging recursively redacts secrets and strips control characters", () => {
  const sanitized = sanitizeLogValue({
    authorization: "Bearer token",
    nested: { refreshToken: "secret", message: "line1\nline2" },
    error: Object.assign(new Error("database URL must not be logged"), { code: "DB_DOWN" }),
  });
  assert.equal(sanitized.authorization, REDACTED);
  assert.equal(sanitized.nested.refreshToken, REDACTED);
  assert.equal(sanitized.nested.message, "line1 line2");
  assert.deepEqual(sanitized.error, { name: "Error", code: "DB_DOWN" });
});
