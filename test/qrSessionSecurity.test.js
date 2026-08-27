const assert = require("node:assert/strict");
const test = require("node:test");
const {
  authorizeQrSubscription,
  createSubscriberCredential,
  qrKey,
  qrRoomName,
  requireQrActor,
  validateQrSessionId,
} = require("../service/qrSessionSecurity.service");

const sessionId = "123e4567-e89b-42d3-a456-426614174000";

test("stores only a hash and authorizes the matching desktop capability", async () => {
  const credential = createSubscriberCredential();
  assert.match(credential.subscriberToken, /^[a-f0-9]{64}$/);
  assert.notEqual(credential.subscriberTokenHash, credential.subscriberToken);

  const redis = {
    get: async (key) => {
      assert.equal(key, qrKey(sessionId));
      return JSON.stringify({ subscriberTokenHash: credential.subscriberTokenHash });
    },
  };
  assert.deepEqual(
    await authorizeQrSubscription({ sessionId, subscriberToken: credential.subscriberToken }, redis),
    { sessionId, roomName: qrRoomName(sessionId) },
  );
});

test("rejects session-id-only joins and incorrect capability tokens", async () => {
  await assert.rejects(authorizeQrSubscription({ sessionId }),
    (error) => error.code === "INVALID_QR_SUBSCRIPTION");
  const credential = createSubscriberCredential();
  const redis = { get: async () => JSON.stringify({ subscriberTokenHash: credential.subscriberTokenHash }) };
  await assert.rejects(
    authorizeQrSubscription({ sessionId, subscriberToken: "a".repeat(64) }, redis),
    (error) => error.code === "QR_SUBSCRIPTION_DENIED",
  );
});

test("binds confirmation and cancellation to the user who scanned", () => {
  assert.doesNotThrow(() => requireQrActor({ userId: "user-a" }, "user-a"));
  assert.throws(() => requireQrActor({ userId: "user-a" }, "user-b"),
    (error) => error.code === "QR_ACTOR_MISMATCH");
});

test("accepts only canonical UUID session identifiers", () => {
  assert.equal(validateQrSessionId(sessionId), sessionId);
  assert.throws(() => validateQrSessionId("../another-room"),
    (error) => error.code === "INVALID_QR_SESSION_ID");
});
