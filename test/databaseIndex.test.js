const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  MESSAGE_IDEMPOTENCY_INDEX_KEYS,
  MESSAGE_IDEMPOTENCY_INDEX_NAME,
  MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
  ensureCriticalDatabaseIndexes,
  isMessageIdempotencyIndexValid,
} = require("../service/databaseIndex.service");

const validIndex = {
  name: MESSAGE_IDEMPOTENCY_INDEX_NAME,
  key: MESSAGE_IDEMPOTENCY_INDEX_KEYS,
  unique: true,
  partialFilterExpression: MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
};

test("recognizes only the exact critical idempotency index", () => {
  assert.equal(isMessageIdempotencyIndexValid(validIndex), true);
  assert.equal(
    isMessageIdempotencyIndexValid({ ...validIndex, unique: false }),
    false,
  );
  assert.equal(
    isMessageIdempotencyIndexValid({
      ...validIndex,
      key: { room_chat_id: 1, user_id: 1, clientMessageId: 1 },
    }),
    false,
  );
});

test("creates and verifies the critical index before returning", async () => {
  const calls = [];
  const chatModel = {
    collection: {
      createIndex: async (keys, options) => {
        calls.push({ operation: "create", keys, options });
      },
      indexes: async () => {
        calls.push({ operation: "verify" });
        return [{ name: "_id_", key: { _id: 1 } }, validIndex];
      },
    },
  };

  await ensureCriticalDatabaseIndexes(chatModel);

  assert.deepEqual(calls.map((call) => call.operation), ["create", "verify"]);
  assert.deepEqual(calls[0].keys, MESSAGE_IDEMPOTENCY_INDEX_KEYS);
  assert.equal(calls[0].options.unique, true);
});

test("fails startup verification when the index is missing", async () => {
  const chatModel = {
    collection: {
      createIndex: async () => {},
      indexes: async () => [{ name: "_id_", key: { _id: 1 } }],
    },
  };

  await assert.rejects(
    ensureCriticalDatabaseIndexes(chatModel),
    /missing or misconfigured/,
  );
});

test("startup ensures critical indexes before Redis and HTTP listen", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../index.js"),
    "utf8",
  );
  const databasePosition = source.indexOf("await database.connect()");
  const indexPosition = source.indexOf("await ensureCriticalDatabaseIndexes()");
  const redisPosition = source.indexOf("await client.connect()");
  const listenPosition = source.indexOf("await listen(server, port)");

  assert.ok(databasePosition < indexPosition);
  assert.ok(indexPosition < redisPosition);
  assert.ok(redisPosition < listenPosition);
});
