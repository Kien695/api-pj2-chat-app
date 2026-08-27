const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Chat = require("../model/chat.model");

test("chat schema has a scoped unique idempotency index", () => {
  const index = Chat.schema.indexes().find(
    ([fields]) =>
      fields.user_id === 1 &&
      fields.room_chat_id === 1 &&
      fields.clientMessageId === 1,
  );

  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, {
    clientMessageId: { $type: "string" },
  });
});

test("message and room writes use the same MongoDB transaction", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/messagePersistence.service.js"),
    "utf8",
  );

  assert.match(source, /runMongoTransaction/);
  assert.match(source, /Chat\.create\([\s\S]*\{ session \}/);
  assert.match(source, /RoomChat\.findOneAndUpdate\([\s\S]*session/);
  assert.match(source, /error\?\.code !== 11000/);
});

test("room membership and its system message share a transaction", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/roomMembershipMutation.service.js"),
    "utf8",
  );

  assert.equal((source.match(/runMongoTransaction/g) || []).length, 4);
  assert.equal((source.match(/Chat\.create/g) || []).length, 3);
  assert.match(source, /findOneAndUpdate\([\s\S]*\{ new: true, session \}/);
});

test("frontend sends clientMessageId and reconciles optimistic messages", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );

  assert.match(source, /window\.crypto\.randomUUID\(\)/);
  assert.match(source, /deliveryStatus: "pending"/);
  assert.match(source, /deliveryStatus: delivered \? "sent" : "failed"/);
  assert.match(source, /item\.clientMessageId === formatted\.clientMessageId/);
});
