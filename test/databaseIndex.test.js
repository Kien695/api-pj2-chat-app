const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  AUTH_SESSION_ID_INDEX_KEYS,
  AUTH_SESSION_ID_INDEX_NAME,
  AUTH_SESSION_TTL_INDEX_KEYS,
  AUTH_SESSION_TTL_INDEX_NAME,
  MESSAGE_HISTORY_INDEX_KEYS,
  MESSAGE_HISTORY_INDEX_NAME,
  MESSAGE_IDEMPOTENCY_INDEX_KEYS,
  MESSAGE_IDEMPOTENCY_INDEX_NAME,
  MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
  MESSAGE_RECEIPT_INDEX_KEYS,
  MESSAGE_RECEIPT_INDEX_NAME,
  PUSH_ENDPOINT_INDEX_KEYS,
  PUSH_ENDPOINT_INDEX_NAME,
  ensureCriticalDatabaseIndexes,
  isMessageHistoryIndexValid,
  isMessageIdempotencyIndexValid,
  isMessageReceiptIndexValid,
  isPushEndpointIndexValid,
  isAuthSessionIdIndexValid,
  isAuthSessionTtlIndexValid,
} = require("../service/databaseIndex.service");

const validIndex = {
  name: MESSAGE_IDEMPOTENCY_INDEX_NAME,
  key: MESSAGE_IDEMPOTENCY_INDEX_KEYS,
  unique: true,
  partialFilterExpression: MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
};
const validHistoryIndex = {
  name: MESSAGE_HISTORY_INDEX_NAME,
  key: MESSAGE_HISTORY_INDEX_KEYS,
};
const validReceiptIndex = {
  name: MESSAGE_RECEIPT_INDEX_NAME,
  key: MESSAGE_RECEIPT_INDEX_KEYS,
  unique: true,
};
const validPushEndpointIndex = {
  name: PUSH_ENDPOINT_INDEX_NAME,
  key: PUSH_ENDPOINT_INDEX_KEYS,
  unique: true,
};
const validAuthSessionIdIndex = {
  name: AUTH_SESSION_ID_INDEX_NAME,
  key: AUTH_SESSION_ID_INDEX_KEYS,
  unique: true,
};
const validAuthSessionTtlIndex = {
  name: AUTH_SESSION_TTL_INDEX_NAME,
  key: AUTH_SESSION_TTL_INDEX_KEYS,
  expireAfterSeconds: 0,
};

const receiptModelWithIndexes = (indexes = [validReceiptIndex]) => ({
  collection: {
    createIndex: async () => {},
    indexes: async () => indexes,
  },
});
const pushModelWithIndexes = (indexes = [validPushEndpointIndex]) => ({
  collection: {
    createIndex: async () => {},
    indexes: async () => indexes,
  },
});
const authSessionModelWithIndexes = (
  indexes = [validAuthSessionIdIndex, validAuthSessionTtlIndex],
) => ({
  collection: {
    createIndex: async () => {},
    indexes: async () => indexes,
  },
});

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

test("recognizes only the exact message history index", () => {
  assert.equal(isMessageHistoryIndexValid(validHistoryIndex), true);
  assert.equal(
    isMessageHistoryIndexValid({ ...validHistoryIndex, unique: true }),
    false,
  );
  assert.equal(
    isMessageHistoryIndexValid({
      ...validHistoryIndex,
      key: { room_chat_id: 1, _id: -1, createdAt: -1 },
    }),
    false,
  );
});

test("recognizes only the unique room and user receipt index", () => {
  assert.equal(isMessageReceiptIndexValid(validReceiptIndex), true);
  assert.equal(
    isMessageReceiptIndexValid({ ...validReceiptIndex, unique: false }),
    false,
  );
});

test("recognizes only the unique push endpoint hash index", () => {
  assert.equal(isPushEndpointIndexValid(validPushEndpointIndex), true);
  assert.equal(
    isPushEndpointIndexValid({ ...validPushEndpointIndex, unique: false }),
    false,
  );
});

test("recognizes exact auth session identity and TTL indexes", () => {
  assert.equal(isAuthSessionIdIndexValid(validAuthSessionIdIndex), true);
  assert.equal(isAuthSessionTtlIndexValid(validAuthSessionTtlIndex), true);
  assert.equal(isAuthSessionIdIndexValid({ ...validAuthSessionIdIndex, unique: false }), false);
  assert.equal(isAuthSessionTtlIndexValid({ ...validAuthSessionTtlIndex, expireAfterSeconds: 60 }), false);
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
        return [
          { name: "_id_", key: { _id: 1 } },
          validIndex,
          validHistoryIndex,
        ];
      },
    },
  };

  const receiptCalls = [];
  const receiptModel = {
    collection: {
      createIndex: async (keys, options) => {
        receiptCalls.push({ operation: "create", keys, options });
      },
      indexes: async () => {
        receiptCalls.push({ operation: "verify" });
        return [validReceiptIndex];
      },
    },
  };
  const pushCalls = [];
  const pushModel = {
    collection: {
      createIndex: async (keys, options) => {
        pushCalls.push({ operation: "create", keys, options });
      },
      indexes: async () => {
        pushCalls.push({ operation: "verify" });
        return [validPushEndpointIndex];
      },
    },
  };

  const authSessionCalls = [];
  const authSessionModel = {
    collection: {
      createIndex: async (keys, options) => authSessionCalls.push({ operation: "create", keys, options }),
      indexes: async () => {
        authSessionCalls.push({ operation: "verify" });
        return [validAuthSessionIdIndex, validAuthSessionTtlIndex];
      },
    },
  };

  await ensureCriticalDatabaseIndexes(chatModel, receiptModel, pushModel, authSessionModel);

  assert.deepEqual(calls.map((call) => call.operation), [
    "create",
    "create",
    "verify",
  ]);
  assert.deepEqual(calls[0].keys, MESSAGE_IDEMPOTENCY_INDEX_KEYS);
  assert.equal(calls[0].options.unique, true);
  assert.deepEqual(calls[1].keys, MESSAGE_HISTORY_INDEX_KEYS);
  assert.equal(calls[1].options.name, MESSAGE_HISTORY_INDEX_NAME);
  assert.deepEqual(receiptCalls.map((call) => call.operation), [
    "create",
    "verify",
  ]);
  assert.deepEqual(receiptCalls[0].keys, MESSAGE_RECEIPT_INDEX_KEYS);
  assert.equal(receiptCalls[0].options.unique, true);
  assert.deepEqual(pushCalls.map((call) => call.operation), ["create", "verify"]);
  assert.deepEqual(pushCalls[0].keys, PUSH_ENDPOINT_INDEX_KEYS);
  assert.equal(pushCalls[0].options.unique, true);
  assert.deepEqual(authSessionCalls.map((call) => call.operation), ["create", "create", "verify"]);
});

test("fails startup verification when the index is missing", async () => {
  const chatModel = {
    collection: {
      createIndex: async () => {},
      indexes: async () => [{ name: "_id_", key: { _id: 1 } }],
    },
  };

  await assert.rejects(
    ensureCriticalDatabaseIndexes(chatModel, receiptModelWithIndexes(), pushModelWithIndexes(), authSessionModelWithIndexes()),
    /missing or misconfigured/,
  );
});

test("fails startup verification when the history index is missing", async () => {
  const chatModel = {
    collection: {
      createIndex: async () => {},
      indexes: async () => [validIndex],
    },
  };

  await assert.rejects(
    ensureCriticalDatabaseIndexes(chatModel, receiptModelWithIndexes(), pushModelWithIndexes(), authSessionModelWithIndexes()),
    /history index is missing or misconfigured/,
  );
});

test("fails startup verification when the receipt index is missing", async () => {
  const chatModel = {
    collection: {
      createIndex: async () => {},
      indexes: async () => [validIndex, validHistoryIndex],
    },
  };
  await assert.rejects(
    ensureCriticalDatabaseIndexes(chatModel, receiptModelWithIndexes([]), pushModelWithIndexes(), authSessionModelWithIndexes()),
    /receipt index is missing or misconfigured/,
  );
});

test("fails startup verification when the push endpoint index is missing", async () => {
  const chatModel = {
    collection: {
      createIndex: async () => {},
      indexes: async () => [validIndex, validHistoryIndex],
    },
  };
  await assert.rejects(
    ensureCriticalDatabaseIndexes(
      chatModel,
      receiptModelWithIndexes(),
      pushModelWithIndexes([]),
      authSessionModelWithIndexes(),
    ),
    /Push endpoint index is missing or misconfigured/,
  );
});

test("fails startup verification when an auth session index is missing", async () => {
  const chatModel = {
    collection: {
      createIndex: async () => {},
      indexes: async () => [validIndex, validHistoryIndex],
    },
  };
  await assert.rejects(
    ensureCriticalDatabaseIndexes(
      chatModel,
      receiptModelWithIndexes(),
      pushModelWithIndexes(),
      authSessionModelWithIndexes([validAuthSessionIdIndex]),
    ),
    /Auth session TTL index is missing or misconfigured/,
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
  const adapterPosition = source.indexOf(
    "await attachSocketRedisAdapter",
  );
  const listenPosition = source.indexOf("await listen(server, port)");

  assert.ok(databasePosition < indexPosition);
  assert.ok(indexPosition < redisPosition);
  assert.ok(redisPosition < adapterPosition);
  assert.ok(adapterPosition < listenPosition);
});
