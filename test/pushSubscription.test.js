const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  decryptSubscription,
  getEncryptionKey,
  normalizePushSubscription,
  registerPushSubscription,
  removePushSubscription,
  removeAllPushSubscriptions,
  removePushSubscriptionForLogout,
} = require("../service/pushSubscription.service");

const key = Buffer.alloc(32, 7);
const userId = "507f1f77bcf86cd799439011";
const subscriptionId = "507f191e810c19729de860ea";
const body = {
  deviceId: "123e4567-e89b-42d3-a456-426614174000",
  subscription: {
    endpoint: "https://push.example.test/subscription/abc",
    expirationTime: null,
    keys: { p256dh: "a".repeat(64), auth: "b".repeat(24) },
  },
};

test("requires a canonical Base64 32-byte subscription encryption key", () => {
  assert.deepEqual(getEncryptionKey(key.toString("base64")), key);
  assert.throws(() => getEncryptionKey("short"), /canonical Base64 32-byte/);
});

test("validates HTTPS push subscriptions and canonical device ids", () => {
  assert.equal(normalizePushSubscription(body).subscription.endpoint, body.subscription.endpoint);
  assert.throws(
    () => normalizePushSubscription({ ...body, subscription: { ...body.subscription, endpoint: "http://push.test/a" } }),
    (error) => error.code === "INVALID_PUSH_SUBSCRIPTION",
  );
  assert.throws(
    () => normalizePushSubscription({ ...body, deviceId: "browser" }),
    (error) => error.code === "INVALID_PUSH_SUBSCRIPTION",
  );
});

test("stores only encrypted subscription credentials and an endpoint hash", async () => {
  let write;
  const model = {
    async findOneAndUpdate(filter, update, options) {
      write = { filter, update, options };
      return { _id: subscriptionId, ...update.$set };
    },
  };
  const record = await registerPushSubscription(
    { userId, body, deviceInfo: " Test browser " },
    model,
    key,
  );

  assert.equal(write.filter.endpointHash.length, 64);
  assert.equal(write.update.$set.endpoint, undefined);
  assert.equal(write.update.$set.deviceInfo, "Test browser");
  assert.equal(write.options.upsert, true);
  assert.deepEqual(decryptSubscription(record, key), {
    endpoint: body.subscription.endpoint,
    keys: body.subscription.keys,
  });
});

test("binds a new push subscription to its authenticated session", async () => {
  let write;
  const model = {
    findOneAndUpdate: async (_filter, update) => { write = update; return { _id: "subscription" }; },
  };
  const sessionId = "123e4567-e89b-42d3-a456-426614174001";
  await registerPushSubscription(
    { userId, body, deviceInfo: "Browser", sessionId },
    model,
    key,
  );
  assert.equal(write.$set.sessionId, sessionId);
});

test("removes only a subscription owned by the authenticated user", async () => {
  let filter;
  const removed = await removePushSubscription(
    { userId, subscriptionId },
    { async deleteOne(value) { filter = value; return { deletedCount: 1 }; } },
  );
  assert.equal(removed, true);
  assert.deepEqual(filter, { _id: subscriptionId, userId });
});

test("logout cleanup ignores invalid hints and removes only the current user's subscription", async () => {
  assert.equal(
    await removePushSubscriptionForLogout(
      { userId, subscriptionId: "tampered" },
      { deleteOne: () => assert.fail("invalid hints must not query MongoDB") },
    ),
    false,
  );
  let filter;
  await removePushSubscriptionForLogout(
    { userId, subscriptionId },
    { async deleteOne(value) { filter = value; return { deletedCount: 1 }; } },
  );
  assert.deepEqual(filter, { _id: subscriptionId, userId });
});

test("security reset cleanup removes every subscription for one user", async () => {
  let filter;
  const count = await removeAllPushSubscriptions(userId, {
    async deleteMany(value) { filter = value; return { deletedCount: 3 }; },
  });
  assert.equal(count, 3);
  assert.deepEqual(filter, { userId });
});

test("push subscription routes authenticate before rate limiting and mutation", () => {
  const source = fs.readFileSync(path.join(__dirname, "../router/user.router.js"), "utf8");
  assert.match(
    source,
    /"\/push-subscriptions",\s*middleware\.auth,\s*restRateLimit\("pushSubscription"\),\s*pushSubscriptionController\.register/,
  );
  assert.match(
    source,
    /"\/push-subscriptions\/:subscriptionId",\s*middleware\.auth,\s*restRateLimit\("pushSubscription"\),\s*pushSubscriptionController\.remove/,
  );
});
