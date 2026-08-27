const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const {
  createRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  rotateRefreshToken,
  verifyRefreshToken,
} = require("../service/refreshTokenRotation.service");
const {
  clearRefreshCookieOptions,
  refreshCookieOptions,
} = require("../utils/authCookie");

const userId = new mongoose.Types.ObjectId().toString();
const secret = "refresh-test-secret-that-is-not-used-in-production";

test("creates typed refresh tokens with jti and stores only their hash", async () => {
  const token = createRefreshToken(userId, jwt.sign, secret);
  const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  assert.equal(decoded.id, userId);
  assert.equal(decoded.tokenType, "refresh");
  assert.match(decoded.jti, /^[0-9a-f-]{36}$/i);
  assert.notEqual(hashRefreshToken(token), token);

  let storedValue;
  const model = {
    updateOne: async (_filter, update) => {
      storedValue = update.$set.refresh_token;
      return { matchedCount: 1 };
    },
  };
  const previousSecret = process.env.JWT_REFRESH_TOKEN;
  process.env.JWT_REFRESH_TOKEN = secret;
  try {
    const issued = await issueRefreshToken(userId, model);
    assert.equal(storedValue, hashRefreshToken(issued));
    assert.notEqual(storedValue, issued);
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_REFRESH_TOKEN;
    else process.env.JWT_REFRESH_TOKEN = previousSecret;
  }
});

test("locks refresh verification to HS256 and rejects access-token claims", () => {
  verifyRefreshToken("token", (_token, _secret, options) => {
    assert.deepEqual(options, { algorithms: ["HS256"] });
    return {
      id: userId,
      tokenType: "refresh",
      jti: "123e4567-e89b-42d3-a456-426614174000",
    };
  }, secret);
  assert.throws(() => verifyRefreshToken("token", () => ({
    id: userId,
    tokenType: "access",
    jti: "123e4567-e89b-42d3-a456-426614174000",
  }), secret), (error) => error.code === "INVALID_REFRESH_TOKEN");
});

test("rotates with compare-and-swap so the old token cannot be replayed", async () => {
  const previousSecret = process.env.JWT_REFRESH_TOKEN;
  process.env.JWT_REFRESH_TOKEN = secret;
  const oldToken = createRefreshToken(userId, jwt.sign, secret);
  let calls = 0;
  const model = {
    findOneAndUpdate: async (filter, update) => {
      calls += 1;
      assert.equal(filter._id, userId);
      assert.equal(filter.refresh_token, hashRefreshToken(oldToken));
      assert.notEqual(update.$set.refresh_token, filter.refresh_token);
      return calls === 1 ? { _id: userId } : null;
    },
  };
  try {
    const rotated = await rotateRefreshToken(oldToken, model);
    assert.equal(rotated.userId, userId);
    assert.notEqual(rotated.refreshToken, oldToken);
    await assert.rejects(rotateRefreshToken(oldToken, model),
      (error) => error.code === "REFRESH_TOKEN_REPLAYED_OR_REVOKED");
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_REFRESH_TOKEN;
    else process.env.JWT_REFRESH_TOKEN = previousSecret;
  }
});

test("uses matching secure cookie attributes for set and clear", () => {
  const previousEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const setOptions = refreshCookieOptions();
    const clearOptions = clearRefreshCookieOptions();
    assert.equal(setOptions.httpOnly, true);
    assert.equal(setOptions.secure, true);
    assert.equal(setOptions.sameSite, "lax");
    assert.equal(setOptions.path, "/");
    assert.equal("maxAge" in clearOptions, false);
    assert.deepEqual(clearOptions, {
      httpOnly: setOptions.httpOnly,
      secure: setOptions.secure,
      sameSite: setOptions.sameSite,
      path: setOptions.path,
    });
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
  }
});
