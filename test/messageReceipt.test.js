const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const mongoose = require("mongoose");
const RoomMessageReceipt = require("../model/room-message-receipt.model");
const {
  buildReceiptAdvance,
  hydrateDeliveredReceipts,
  isBoundaryAfter,
  normalizeMessageReceiptInput,
  recordMessageReceipt,
} = require("../service/messageReceipt.service");

test("socket delivery receipt derives identity and status on the server", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../socket/index.js"),
    "utf8",
  );
  assert.match(source, /"CLIENT_MESSAGE_DELIVERED"/);
  assert.match(source, /recordMessageReceipt\(\{[\s\S]*?userId,[\s\S]*?status: "delivered"/);
  assert.match(source, /io\.to\(result\.message\.user_id\.toString\(\)\)\.emit\(/);
  assert.match(source, /io\.to\(userId\)\.emit\("SERVER_MESSAGE_RECEIPT"/);
});

test("socket read receipt requires a message boundary and preserves newer unread", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../socket/index.js"),
    "utf8",
  );
  const readHandler = source.slice(
    source.indexOf('"CLIENT_READ_ROOM"'),
    source.indexOf('"callToUser"'),
  );
  assert.match(readHandler, /validateMessageReceiptPayload\(payload\)/);
  assert.match(readHandler, /status: "read"/);
  assert.match(readHandler, /"lastMessage\.createdAt": \{ \$lte: result\.message\.createdAt \}/);
  assert.match(readHandler, /unreadReset: Boolean\(updatedRoom\)/);
  assert.doesNotMatch(readHandler, /validateRoomActionPayload\(payload\)/);
});

const olderId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439011");
const newerId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439012");
const createdAt = new Date("2026-01-01T00:00:00.000Z");

test("receipt schema is unique per room and user", () => {
  const index = RoomMessageReceipt.schema.indexes().find(
    ([fields]) => fields.roomId === 1 && fields.userId === 1,
  );
  assert.ok(index);
  assert.equal(index[1].unique, true);
});

test("hydrates sent messages from room delivery checkpoints", async () => {
  const senderId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439020");
  const recipientId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439021");
  const firstMessage = {
    _id: olderId,
    user_id: { _id: senderId },
    type: "text",
    createdAt,
  };
  const laterMessage = {
    _id: newerId,
    user_id: { _id: senderId },
    type: "text",
    createdAt: new Date(createdAt.getTime() + 1000),
  };
  const receiptModel = {
    find() {
      return {
        select() {
          return {
            async lean() {
              return [{
                userId: recipientId,
                lastDeliveredMessageId: olderId,
                lastDeliveredMessageCreatedAt: createdAt,
              }];
            },
          };
        },
      };
    },
  };

  const hydrated = await hydrateDeliveredReceipts({
    messages: [firstMessage, laterMessage],
    roomId: "507f1f77bcf86cd799439030",
    senderUserId: senderId,
    receiptModel,
  });

  assert.equal(hydrated[0].deliveryStatus, "delivered");
  assert.deepEqual(hydrated[0].deliveredBy, [recipientId.toString()]);
  assert.equal(hydrated[1].deliveryStatus, "sent");
  assert.deepEqual(hydrated[1].deliveredBy, []);
});

test("hydrates read status with priority over delivered status", async () => {
  const senderId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439020");
  const recipientId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439021");
  const receiptModel = {
    find: () => ({
      select: () => ({
        lean: async () => [{
          userId: recipientId,
          lastDeliveredMessageId: olderId,
          lastDeliveredMessageCreatedAt: createdAt,
          lastReadMessageId: olderId,
          lastReadMessageCreatedAt: createdAt,
        }],
      }),
    }),
  };

  const [hydrated] = await hydrateDeliveredReceipts({
    messages: [{
      _id: olderId,
      user_id: { _id: senderId },
      type: "text",
      createdAt,
    }],
    roomId: "507f1f77bcf86cd799439030",
    senderUserId: senderId,
    receiptModel,
  });

  assert.equal(hydrated.deliveryStatus, "read");
  assert.deepEqual(hydrated.deliveredBy, [recipientId.toString()]);
  assert.deepEqual(hydrated.readBy, [recipientId.toString()]);
});

test("does not expose receipt state on messages from another sender", async () => {
  const senderId = new mongoose.Types.ObjectId("507f1f77bcf86cd799439020");
  const message = {
    _id: olderId,
    user_id: { _id: new mongoose.Types.ObjectId("507f1f77bcf86cd799439021") },
    type: "text",
    createdAt,
  };
  const receiptModel = {
    find: () => ({
      select: () => ({ lean: async () => [] }),
    }),
  };

  const [hydrated] = await hydrateDeliveredReceipts({
    messages: [message],
    roomId: "507f1f77bcf86cd799439030",
    senderUserId: senderId,
    receiptModel,
  });
  assert.equal(hydrated.deliveryStatus, undefined);
  assert.equal(hydrated.deliveredBy, undefined);
  assert.equal(hydrated.readBy, undefined);
});

test("validates canonical receipt identifiers and status", () => {
  const result = normalizeMessageReceiptInput({ roomId: olderId.toString(), messageId: newerId.toString(), status: "delivered" });
  assert.equal(result.roomId.toString(), olderId.toString());
  assert.throws(
    () => normalizeMessageReceiptInput({ roomId: "bad", messageId: newerId.toString(), status: "read" }),
    (error) => error.code === "INVALID_RECEIPT_ROOM",
  );
  assert.throws(
    () => normalizeMessageReceiptInput({ roomId: olderId.toString(), messageId: newerId.toString(), status: "sent" }),
    (error) => error.code === "INVALID_RECEIPT_STATUS",
  );
});

test("orders receipt checkpoints by createdAt and message id", () => {
  assert.equal(isBoundaryAfter({ _id: newerId, createdAt }, createdAt, olderId), true);
  assert.equal(isBoundaryAfter({ _id: olderId, createdAt }, createdAt, newerId), false);
  assert.equal(isBoundaryAfter({ _id: olderId, createdAt: new Date(createdAt.getTime() + 1) }, createdAt, newerId), true);
});

test("read advances both delivered and read while old receipts are idempotent", () => {
  const now = new Date("2026-01-01T00:01:00.000Z");
  const message = { _id: newerId, createdAt };
  const set = buildReceiptAdvance({ receipt: null, message, status: "read", now });
  assert.equal(set.lastDeliveredMessageId, newerId);
  assert.equal(set.lastReadMessageId, newerId);
  const unchanged = buildReceiptAdvance({
    receipt: {
      lastDeliveredMessageId: newerId,
      lastDeliveredMessageCreatedAt: createdAt,
      lastReadMessageId: newerId,
      lastReadMessageCreatedAt: createdAt,
    },
    message: { _id: olderId, createdAt },
    status: "read",
    now,
  });
  assert.deepEqual(unchanged, {});
});

test("records an owner-bound receipt only after room and message validation", async () => {
  const actorId = new mongoose.Types.ObjectId();
  const message = { _id: newerId, user_id: olderId, createdAt };
  const createdReceipts = [];
  const result = await recordMessageReceipt({
    roomId: olderId.toString(),
    userId: actorId.toString(),
    messageId: newerId.toString(),
    status: "delivered",
    roomModel: { exists: async () => ({ _id: olderId }) },
    chatModel: {
      findOne: () => ({ select: async () => message }),
    },
    receiptModel: {
      findOne: async () => null,
      create: async (value) => {
        createdReceipts.push(value);
        return value;
      },
    },
  });

  assert.equal(result.advanced, true);
  assert.equal(createdReceipts.length, 1);
  assert.equal(createdReceipts[0].userId.toString(), actorId.toString());
  assert.equal(createdReceipts[0].lastDeliveredMessageId, newerId);
  assert.equal(createdReceipts[0].lastReadMessageId, undefined);
});

test("rejects outsider, missing message, and receipt for own message", async () => {
  const actorId = new mongoose.Types.ObjectId();
  const input = {
    roomId: olderId.toString(),
    userId: actorId.toString(),
    messageId: newerId.toString(),
    status: "read",
  };
  await assert.rejects(
    recordMessageReceipt({
      ...input,
      roomModel: { exists: async () => null },
    }),
    (error) => error.code === "ROOM_ACCESS_DENIED",
  );
  await assert.rejects(
    recordMessageReceipt({
      ...input,
      roomModel: { exists: async () => ({}) },
      chatModel: { findOne: () => ({ select: async () => null }) },
    }),
    (error) => error.code === "RECEIPT_MESSAGE_NOT_FOUND",
  );
  await assert.rejects(
    recordMessageReceipt({
      ...input,
      roomModel: { exists: async () => ({}) },
      chatModel: {
        findOne: () => ({
          select: async () => ({ _id: newerId, user_id: actorId, createdAt }),
        }),
      },
    }),
    (error) => error.code === "OWN_MESSAGE_RECEIPT_NOT_ALLOWED",
  );
});
