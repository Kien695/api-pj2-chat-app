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

const isMessageIdempotencyIndexValid = (index) =>
  index?.name === MESSAGE_IDEMPOTENCY_INDEX_NAME &&
  index.unique === true &&
  JSON.stringify(index.key) ===
    JSON.stringify(MESSAGE_IDEMPOTENCY_INDEX_KEYS) &&
  JSON.stringify(index.partialFilterExpression) ===
    JSON.stringify(MESSAGE_IDEMPOTENCY_PARTIAL_FILTER);

const ensureCriticalDatabaseIndexes = async (chatModel = Chat) => {
  await chatModel.collection.createIndex(MESSAGE_IDEMPOTENCY_INDEX_KEYS, {
    name: MESSAGE_IDEMPOTENCY_INDEX_NAME,
    unique: true,
    partialFilterExpression: MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
  });

  const indexes = await chatModel.collection.indexes();
  const index = indexes.find(
    (candidate) => candidate.name === MESSAGE_IDEMPOTENCY_INDEX_NAME,
  );
  if (!isMessageIdempotencyIndexValid(index)) {
    throw new Error("Message idempotency index is missing or misconfigured");
  }
};

module.exports = {
  MESSAGE_IDEMPOTENCY_INDEX_KEYS,
  MESSAGE_IDEMPOTENCY_INDEX_NAME,
  MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
  ensureCriticalDatabaseIndexes,
  isMessageIdempotencyIndexValid,
};
