const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  configureWebPush,
  createIncomingCallPushPayload,
  createMessagePushPayload,
  notifyIncomingCall,
  notifyMessageRecipients,
  validatePushNotificationConfig,
} = require("../service/pushNotification.service");
const { encryptSubscription } = require("../service/pushSubscription.service");

const key = Buffer.alloc(32, 8);
const subscription = {
  endpoint: "https://push.example.test/a",
  keys: { p256dh: "a".repeat(64), auth: "b".repeat(24) },
};

test("configures VAPID only from complete validated server configuration", () => {
  let configured;
  const provider = {
    setVapidDetails(...values) { configured = values; },
  };
  assert.equal(
    configureWebPush(
      {
        PUSH_VAPID_SUBJECT: "mailto:admin@example.test",
        PUSH_VAPID_PUBLIC_KEY: "public",
        PUSH_VAPID_PRIVATE_KEY: "private",
      },
      provider,
    ),
    provider,
  );
  assert.deepEqual(configured, ["mailto:admin@example.test", "public", "private"]);
  assert.throws(() => configureWebPush({}, provider), /are required/);
  assert.deepEqual(
    validatePushNotificationConfig({
      PUSH_VAPID_SUBJECT: "https://example.test/push",
      PUSH_VAPID_PUBLIC_KEY: "public",
      PUSH_VAPID_PRIVATE_KEY: "private",
    }),
    { subject: "https://example.test/push", publicKey: "public", privateKey: "private" },
  );
  assert.throws(
    () => validatePushNotificationConfig({
      PUSH_VAPID_SUBJECT: "admin@example.test",
      PUSH_VAPID_PUBLIC_KEY: "public",
      PUSH_VAPID_PRIVATE_KEY: "private",
    }),
    /mailto: or https:\/\//,
  );
});

test("message push payload contains routing metadata but no message content", () => {
  const payload = createMessagePushPayload({
    roomId: "room-1",
    messageId: "message-1",
    senderName: "Alice",
    type: "text",
  });
  const parsed = JSON.parse(payload);
  assert.equal(parsed.url, "/chat/room-1");
  assert.equal(parsed.messageId, "message-1");
  assert.equal(parsed.content, undefined);
});

test("incoming-call push contains no WebRTC signaling material", async () => {
  const payload = JSON.parse(
    createIncomingCallPushPayload({
      callId: "call-1",
      callerName: "Alice",
      type: "video",
    }),
  );
  assert.equal(payload.type, "incoming-call");
  assert.equal(payload.callId, "call-1");
  assert.equal(payload.signal, undefined);
  assert.equal(payload.signalData, undefined);

  let options;
  await notifyIncomingCall(
    {
      calleeId: "recipient",
      callId: "call-1",
      caller: { _id: "sender", name: "Alice" },
      type: "video",
    },
    {
      model: {
        find(filter) {
          assert.deepEqual(filter, {
            userId: { $in: ["recipient"] },
            disabledAt: null,
          });
          return {
            async lean() {
              return [{ _id: "one", ...encryptSubscription(subscription, key) }];
            },
          };
        },
      },
      provider: {
        async sendNotification(value, sentPayload, sentOptions) {
          assert.deepEqual(value, subscription);
          assert.equal(JSON.parse(sentPayload).callId, "call-1");
          options = sentOptions;
        },
      },
      encryptionKey: key,
    },
  );
  assert.equal(options.TTL, 30);
});

test("sends only to room recipients and isolates provider failures", async () => {
  const records = [
    { _id: "one", userId: "recipient", ...encryptSubscription(subscription, key) },
    { _id: "two", userId: "recipient", ...encryptSubscription(subscription, key) },
  ];
  const sentPayloads = [];
  const errors = [];
  const result = await notifyMessageRecipients(
    {
      room: {
        _id: "507f1f77bcf86cd799439012",
        users: [{ user_id: "sender" }, { user_id: "recipient" }],
      },
      message: { _id: "507f1f77bcf86cd799439013", type: "text" },
      sender: { _id: "sender", name: "Alice" },
    },
    {
      model: {
        find(filter) {
          assert.deepEqual(filter, {
            userId: { $in: ["recipient"] },
            disabledAt: null,
          });
          return { async lean() { return records; } };
        },
        async updateMany(filter, update) {
          assert.deepEqual(filter, { _id: { $in: ["two"] } });
          assert.ok(update.$set.disabledAt instanceof Date);
        },
      },
      provider: {
        async sendNotification(value, payload) {
          sentPayloads.push({ value, payload });
          if (sentPayloads.length === 2) throw Object.assign(new Error("gone"), { statusCode: 410 });
        },
      },
      encryptionKey: key,
      logger: { error(message, metadata) { errors.push({ message, metadata }); } },
    },
  );

  assert.deepEqual(result, { sent: 1, failed: 1, retryableFailed: 0, disabled: 1 });
  assert.deepEqual(sentPayloads[0].value, subscription);
  assert.equal(errors[0].metadata.statusCode, 410);
});

test("socket enqueues push only for a newly committed message without awaiting it", () => {
  const source = fs.readFileSync(path.join(__dirname, "../socket/index.js"), "utf8");
  const duplicateGuard = source.indexOf("if (!persisted.duplicate)");
  const notification = source.indexOf("enqueueMessagePush({", duplicateGuard);
  const resultPush = source.indexOf("results.push({", notification);
  assert.ok(duplicateGuard >= 0 && notification > duplicateGuard);
  assert.ok(resultPush > notification);
  assert.doesNotMatch(source.slice(duplicateGuard, notification + 30), /await enqueueMessagePush/);
});

test("socket enqueues call push only after online validation and pending-call creation", () => {
  const source = fs.readFileSync(path.join(__dirname, "../socket/index.js"), "utf8");
  const handler = source.indexOf('registerAsyncSocketHandler(socket, "callToUser"');
  const onlineCheck = source.indexOf("isPresenceOnline", handler);
  const stateCreation = source.indexOf("await createPendingCall", handler);
  const realtimeSignal = source.indexOf('io.to(calleeId).emit("makeUser"', handler);
  const pushEnqueue = source.indexOf("enqueueIncomingCallPush({", handler);
  assert.ok(handler >= 0 && onlineCheck > handler);
  assert.ok(stateCreation > onlineCheck);
  assert.ok(pushEnqueue > stateCreation && pushEnqueue > realtimeSignal);
  const pushBlock = source.slice(pushEnqueue, source.indexOf("if (typeof acknowledgement", pushEnqueue));
  assert.doesNotMatch(pushBlock, /signal/);
  assert.doesNotMatch(pushBlock, /await enqueueIncomingCallPush/);
});
