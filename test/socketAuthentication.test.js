const assert = require("node:assert/strict");
const test = require("node:test");
const { authenticateSocket } = require("../service/socketAuthentication.service");

test("allows an explicitly unauthenticated socket for the QR bootstrap flow", async () => {
  assert.equal(await authenticateSocket(undefined), null);
  assert.equal(await authenticateSocket(""), null);
});

test("accepts a valid token and returns its trusted database user", async () => {
  const user = { _id: "trusted-user", name: "Trusted" };
  const result = await authenticateSocket("valid-token", async (token) => {
    assert.equal(token, "valid-token");
    return user;
  });
  assert.equal(result, user);
});

test("rejects malformed and oversized handshake tokens", async () => {
  await assert.rejects(authenticateSocket({ token: "object" }),
    (error) => error.data.code === "INVALID_SOCKET_TOKEN");
  await assert.rejects(authenticateSocket("a".repeat(4097)),
    (error) => error.data.code === "INVALID_SOCKET_TOKEN");
});

test("rejects invalid, expired, and orphaned authenticated sessions", async () => {
  await assert.rejects(authenticateSocket("expired", async () => {
    throw new Error("jwt expired");
  }), (error) => error.data.code === "SOCKET_AUTHENTICATION_FAILED");
  await assert.rejects(authenticateSocket("orphaned", async () => null),
    (error) => error.data.code === "SOCKET_AUTHENTICATION_FAILED");
});
