const Chat = require("../model/chat.model");

const MESSAGE_IDEMPOTENCY_INDEX_NAME =
  "user_id_1_room_chat_id_1_clientMessageId_1";
const MESSAGE_IDEMPOTENCY_INDEX_KEYS = {
  user_id: 1,
  room_chat_id: 1,
  clientMessageId: 1,
};
const MESSAGE_IDEMPOTENCY_PARTIAL_FILTER = {
  clientMessageId: { $type: "string" },
};
const MESSAGE_HISTORY_INDEX_NAME = "room_chat_id_1_createdAt_-1__id_-1";
const MESSAGE_HISTORY_INDEX_KEYS = {
  room_chat_id: 1,
  createdAt: -1,
  _id: -1,
};

const isMessageIdempotencyIndexValid = (index) =>
  index?.name === MESSAGE_IDEMPOTENCY_INDEX_NAME &&
  index.unique === true &&
  JSON.stringify(index.key) ===
    JSON.stringify(MESSAGE_IDEMPOTENCY_INDEX_KEYS) &&
  JSON.stringify(index.partialFilterExpression) ===
    JSON.stringify(MESSAGE_IDEMPOTENCY_PARTIAL_FILTER);

const isMessageHistoryIndexValid = (index) =>
  index?.name === MESSAGE_HISTORY_INDEX_NAME &&
  index.unique !== true &&
  JSON.stringify(index.key) === JSON.stringify(MESSAGE_HISTORY_INDEX_KEYS);

const ensureCriticalDatabaseIndexes = async (chatModel = Chat) => {
  await chatModel.collection.createIndex(MESSAGE_IDEMPOTENCY_INDEX_KEYS, {
    name: MESSAGE_IDEMPOTENCY_INDEX_NAME,
    unique: true,
    partialFilterExpression: MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
  });
  await chatModel.collection.createIndex(MESSAGE_HISTORY_INDEX_KEYS, {
    name: MESSAGE_HISTORY_INDEX_NAME,
  });

  const indexes = await chatModel.collection.indexes();
  const idempotencyIndex = indexes.find(
    (candidate) => candidate.name === MESSAGE_IDEMPOTENCY_INDEX_NAME,
  );
  if (!isMessageIdempotencyIndexValid(idempotencyIndex)) {
    throw new Error("Message idempotency index is missing or misconfigured");
  }
  const historyIndex = indexes.find(
    (candidate) => candidate.name === MESSAGE_HISTORY_INDEX_NAME,
  );
  if (!isMessageHistoryIndexValid(historyIndex)) {
    throw new Error("Message history index is missing or misconfigured");
  }
};

module.exports = {
  MESSAGE_HISTORY_INDEX_KEYS,
  MESSAGE_HISTORY_INDEX_NAME,
  MESSAGE_IDEMPOTENCY_INDEX_KEYS,
  MESSAGE_IDEMPOTENCY_INDEX_NAME,
  MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
  ensureCriticalDatabaseIndexes,
  isMessageHistoryIndexValid,
  isMessageIdempotencyIndexValid,
};
