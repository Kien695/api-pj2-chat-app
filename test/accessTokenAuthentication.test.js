const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const {
  extractBearerToken,
  verifyAccessToken,
} = require("../service/accessTokenAuthentication.service");

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
