const Chat = require("../model/chat.model");
const RoomMessageReceipt = require("../model/room-message-receipt.model");
const PushSubscription = require("../model/push-subscription.model");
const AuthSession = require("../model/auth-session.model");

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
const MESSAGE_RECEIPT_INDEX_NAME = "roomId_1_userId_1";
const MESSAGE_RECEIPT_INDEX_KEYS = { roomId: 1, userId: 1 };
const PUSH_ENDPOINT_INDEX_NAME = "endpointHash_1";
const PUSH_ENDPOINT_INDEX_KEYS = { endpointHash: 1 };
const AUTH_SESSION_ID_INDEX_NAME = "sessionId_1";
const AUTH_SESSION_ID_INDEX_KEYS = { sessionId: 1 };
const AUTH_SESSION_TTL_INDEX_NAME = "expiresAt_1";
const AUTH_SESSION_TTL_INDEX_KEYS = { expiresAt: 1 };

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

const isMessageReceiptIndexValid = (index) =>
  index?.name === MESSAGE_RECEIPT_INDEX_NAME &&
  index.unique === true &&
  JSON.stringify(index.key) === JSON.stringify(MESSAGE_RECEIPT_INDEX_KEYS);

const isPushEndpointIndexValid = (index) =>
  index?.name === PUSH_ENDPOINT_INDEX_NAME &&
  index.unique === true &&
  JSON.stringify(index.key) === JSON.stringify(PUSH_ENDPOINT_INDEX_KEYS);

const isAuthSessionIdIndexValid = (index) =>
  index?.name === AUTH_SESSION_ID_INDEX_NAME &&
  index.unique === true &&
  JSON.stringify(index.key) === JSON.stringify(AUTH_SESSION_ID_INDEX_KEYS);

const isAuthSessionTtlIndexValid = (index) =>
  index?.name === AUTH_SESSION_TTL_INDEX_NAME &&
  index.expireAfterSeconds === 0 &&
  JSON.stringify(index.key) === JSON.stringify(AUTH_SESSION_TTL_INDEX_KEYS);

const ensureCriticalDatabaseIndexes = async (
  chatModel = Chat,
  receiptModel = RoomMessageReceipt,
  pushSubscriptionModel = PushSubscription,
  authSessionModel = AuthSession,
) => {
  await chatModel.collection.createIndex(MESSAGE_IDEMPOTENCY_INDEX_KEYS, {
    name: MESSAGE_IDEMPOTENCY_INDEX_NAME,
    unique: true,
    partialFilterExpression: MESSAGE_IDEMPOTENCY_PARTIAL_FILTER,
  });
  await chatModel.collection.createIndex(MESSAGE_HISTORY_INDEX_KEYS, {
    name: MESSAGE_HISTORY_INDEX_NAME,
  });
  await receiptModel.collection.createIndex(MESSAGE_RECEIPT_INDEX_KEYS, {
    name: MESSAGE_RECEIPT_INDEX_NAME,
    unique: true,
  });
  await pushSubscriptionModel.collection.createIndex(PUSH_ENDPOINT_INDEX_KEYS, {
    name: PUSH_ENDPOINT_INDEX_NAME,
    unique: true,
  });
  await authSessionModel.collection.createIndex(AUTH_SESSION_ID_INDEX_KEYS, {
    name: AUTH_SESSION_ID_INDEX_NAME,
    unique: true,
  });
  await authSessionModel.collection.createIndex(AUTH_SESSION_TTL_INDEX_KEYS, {
    name: AUTH_SESSION_TTL_INDEX_NAME,
    expireAfterSeconds: 0,
  });

  const [indexes, receiptIndexes, pushIndexes, authSessionIndexes] = await Promise.all([
    chatModel.collection.indexes(),
    receiptModel.collection.indexes(),
    pushSubscriptionModel.collection.indexes(),
    authSessionModel.collection.indexes(),
  ]);
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
  const receiptIndex = receiptIndexes.find(
    (candidate) => candidate.name === MESSAGE_RECEIPT_INDEX_NAME,
  );
  if (!isMessageReceiptIndexValid(receiptIndex)) {
    throw new Error("Message receipt index is missing or misconfigured");
  }
  const pushEndpointIndex = pushIndexes.find(
    (candidate) => candidate.name === PUSH_ENDPOINT_INDEX_NAME,
  );
  if (!isPushEndpointIndexValid(pushEndpointIndex)) {
    throw new Error("Push endpoint index is missing or misconfigured");
  }
  if (!isAuthSessionIdIndexValid(
    authSessionIndexes.find((candidate) => candidate.name === AUTH_SESSION_ID_INDEX_NAME),
  )) {
    throw new Error("Auth session identity index is missing or misconfigured");
  }
  if (!isAuthSessionTtlIndexValid(
    authSessionIndexes.find((candidate) => candidate.name === AUTH_SESSION_TTL_INDEX_NAME),
  )) {
    throw new Error("Auth session TTL index is missing or misconfigured");
  }
};

module.exports = {
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
};
