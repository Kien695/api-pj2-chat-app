const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_FRIEND_REQUEST_MESSAGE_LENGTH,
  SocketPayloadValidationError,
  validateFriendRequestPayload,
  validateFriendTarget,
  validateMessageRemovalPayload,
  validateRoomActionPayload,
  validateTypingPayload,
} = require("../service/socketPayloadValidation.service");

const actorId = "507f1f77bcf86cd799439011";
const targetId = "507F191E810C19729DE860EA";

test("normalizes a valid friend request payload", () => {
  assert.deepEqual(
    validateFriendRequestPayload({ userId: targetId, text: "  Xin chào  " }, actorId),
    { userId: targetId.toLowerCase(), text: "Xin chào" },
  );
});

test("rejects malformed, operator and self friend targets", () => {
  for (const value of [null, "bad-id", { $ne: null }, [targetId]]) {
    assert.throws(
      () => validateFriendTarget(value, actorId),
      SocketPayloadValidationError,
    );
  }
  assert.throws(
    () => validateFriendTarget(actorId, actorId),
    (error) => error.code === "SELF_FRIEND_ACTION_NOT_ALLOWED",
  );
});

test("rejects malformed and oversized friend request messages", () => {
  for (const payload of [null, [], { userId: targetId, text: {} }]) {
    assert.throws(
      () => validateFriendRequestPayload(payload, actorId),
      SocketPayloadValidationError,
    );
  }
  assert.throws(
    () => validateFriendRequestPayload({
      userId: targetId,
      text: "x".repeat(MAX_FRIEND_REQUEST_MESSAGE_LENGTH + 1),
    }, actorId),
    (error) => error.code === "INVALID_FRIEND_REQUEST_MESSAGE",
  );
});

test("validates every friendship event before its database operation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../socket/index.js"),
    "utf8",
  );
  assert.equal(
    source.match(/validateFriendTarget\(userId, myUserId\)/g)?.length,
    4,
  );
  assert.match(source, /validateFriendRequestPayload\(content, myUserId\)/);
});

test("accepts only boolean typing states", () => {
  assert.equal(validateTypingPayload(true), true);
  assert.equal(validateTypingPayload(false), false);
  for (const value of ["true", 1, null, {}, []]) {
    assert.throws(
      () => validateTypingPayload(value),
      (error) => error.code === "INVALID_TYPING_STATE",
    );
  }
});

test("validates room and message action payloads", () => {
  const roomChatId = "507F191E810C19729DE860EA";
  const selectedMessageId = "507f1f77bcf86cd799439012";
  assert.deepEqual(validateRoomActionPayload({ roomChatId }), {
    roomChatId: roomChatId.toLowerCase(),
  });
  assert.deepEqual(
    validateMessageRemovalPayload({ roomChatId, selectedMessageId }),
    { roomChatId: roomChatId.toLowerCase(), selectedMessageId },
  );
  for (const payload of [null, [], {}, { roomChatId: { $ne: null } }]) {
    assert.throws(
      () => validateRoomActionPayload(payload),
      SocketPayloadValidationError,
    );
  }
  assert.throws(
    () => validateMessageRemovalPayload({ roomChatId, selectedMessageId: [] }),
    (error) => error.code === "INVALID_MESSAGE_ID",
  );
});

test("guards join, read, delete and typing before protected work", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../socket/index.js"),
    "utf8",
  );
  assert.equal(source.match(/validateRoomActionPayload\(payload\)/g)?.length, 2);
  assert.match(source, /validateMessageRemovalPayload\(payload\)/);
  assert.match(source, /validateTypingPayload\(type\)/);
});
