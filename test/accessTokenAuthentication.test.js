const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const {
  authenticateAccessToken,
  extractBearerToken,
  verifyAccessToken,
} = require("../service/accessTokenAuthentication.service");
const jwt = require("jsonwebtoken");

test("accepts only an exact Bearer authorization header", () => {
  assert.equal(extractBearerToken("Bearer valid.jwt.token"), "valid.jwt.token");
  assert.equal(extractBearerToken(undefined), null);
  for (const header of [
    "valid.jwt.token",
    "Basic valid.jwt.token",
    "Bearer",
    "Bearer  two-values",
    "bearer valid.jwt.token",
  ]) {
    assert.throws(() => extractBearerToken(header),
      (error) => error.code === "INVALID_AUTHORIZATION_HEADER");
  }
});

test("locks verification to HS256 and requires a MongoDB user id", () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const decoded = verifyAccessToken("token", "secret", (token, secret, options) => {
    assert.equal(token, "token");
    assert.equal(secret, "secret");
    assert.deepEqual(options, { algorithms: ["HS256"] });
    return {
      id: userId,
      tokenType: "access",
      jti: "123e4567-e89b-42d3-a456-426614174000",
    };
  });
  assert.equal(decoded.id, userId);
  assert.throws(() => verifyAccessToken("token", "secret", () => ({ id: "admin" })),
    (error) => error.code === "INVALID_ACCESS_TOKEN");
});

test("returns an optional session claim for downstream per-device actions", () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const sessionId = "123e4567-e89b-42d3-a456-426614174001";
  const decoded = verifyAccessToken("token", "secret", () => ({
    id: userId,
    tokenType: "access",
    jti: "123e4567-e89b-42d3-a456-426614174000",
    sid: sessionId,
  }));
  assert.equal(decoded.sid, sessionId);
  assert.throws(() => verifyAccessToken("token", "secret", () => ({
    id: userId,
    tokenType: "access",
    jti: "123e4567-e89b-42d3-a456-426614174000",
    sid: "invalid-session",
  })), (error) => error.code === "INVALID_ACCESS_TOKEN");
});

test("rejects refresh-token claims at access-token protected APIs", () => {
  assert.throws(() => verifyAccessToken("token", "secret", () => ({
    id: new mongoose.Types.ObjectId().toString(),
    tokenType: "refresh",
    jti: "123e4567-e89b-42d3-a456-426614174000",
  })), (error) => error.code === "INVALID_ACCESS_TOKEN");
});

test("maps expired and invalid JWTs to stable authentication errors", () => {
  const expired = new Error("expired");
  expired.name = "TokenExpiredError";
  assert.throws(() => verifyAccessToken("token", "secret", () => { throw expired; }),
    (error) => error.code === "ACCESS_TOKEN_EXPIRED" && error.expired === true);
  assert.throws(() => verifyAccessToken("token", "secret", () => { throw new Error("bad signature"); }),
    (error) => error.code === "INVALID_ACCESS_TOKEN");
});

test("a missing header cannot be replaced by cookie or query credentials", () => {
  assert.equal(extractBearerToken(undefined), null);
  assert.throws(() => verifyAccessToken(null),
    (error) => error.code === "ACCESS_TOKEN_REQUIRED");
});

test("session-bound access tokens require an active matching session", async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const sessionId = "123e4567-e89b-42d3-a456-426614174001";
  const secret = "access-enforcement-test-secret-long-enough";
  const token = jwt.sign({
    id: userId,
    tokenType: "access",
    jti: "123e4567-e89b-42d3-a456-426614174000",
    sid: sessionId,
  }, secret, { algorithm: "HS256", expiresIn: "10m" });
  const previousSecret = process.env.JWT_ACCESS_TOKEN;
  process.env.JWT_ACCESS_TOKEN = secret;
  const query = (value) => ({
    select() { return this; },
    lean: async () => value,
  });
  try {
    const decoded = await authenticateAccessToken(token, { findOne: () => query({ _id: "active" }) });
    assert.equal(decoded.sid, sessionId);
    await assert.rejects(
      authenticateAccessToken(token, { findOne: () => query(null) }),
      (error) => error.code === "ACCESS_SESSION_REVOKED",
    );
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_ACCESS_TOKEN;
    else process.env.JWT_ACCESS_TOKEN = previousSecret;
  }
});
