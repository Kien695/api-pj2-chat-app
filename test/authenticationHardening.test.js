const assert = require("node:assert/strict");
const test = require("node:test");
const {
  validateAuthenticationConfig,
} = require("../service/authenticationConfig.service");
const {
  consumeOAuthLoginTicket,
  createOAuthLoginTicket,
  ticketKey,
} = require("../service/oauthLoginTicket.service");

test("requires sufficiently long and distinct JWT secrets", () => {
  assert.doesNotThrow(() => validateAuthenticationConfig({
    JWT_ACCESS_TOKEN: "a".repeat(24),
    JWT_REFRESH_TOKEN: "b".repeat(24),
  }));
  assert.throws(() => validateAuthenticationConfig({
    JWT_ACCESS_TOKEN: "short",
    JWT_REFRESH_TOKEN: "b".repeat(24),
  }));
  assert.throws(() => validateAuthenticationConfig({
    JWT_ACCESS_TOKEN: "same-secret-value-long-enough",
    JWT_REFRESH_TOKEN: "same-secret-value-long-enough",
  }));
});

test("OAuth URL code is one-time, short-lived, and stored under a hash key", async () => {
  const values = new Map();
  let storedOptions;
  const redis = {
    set: async (key, value, options) => {
      values.set(key, value);
      storedOptions = options;
    },
    getDel: async (key) => {
      const value = values.get(key) || null;
      values.delete(key);
      return value;
    },
  };
  const code = await createOAuthLoginTicket("user-id", "document-id", redis);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ticketKey(code).includes(code), false);
  assert.deepEqual(storedOptions, { EX: 60 });
  assert.deepEqual(await consumeOAuthLoginTicket(code, redis), {
    userId: "user-id",
    documentId: "document-id",
  });
  await assert.rejects(consumeOAuthLoginTicket(code, redis),
    (error) => error.code === "OAUTH_LOGIN_CODE_EXPIRED");
});

test("OAuth exchange rejects malformed codes before accessing Redis", async () => {
  let queried = false;
  await assert.rejects(
    consumeOAuthLoginTicket("not-a-valid-code", {
      getDel: async () => { queried = true; },
    }),
    (error) => error.code === "INVALID_OAUTH_LOGIN_CODE",
  );
  assert.equal(queried, false);
});
