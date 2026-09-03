const mongoose = require("mongoose");
const Chat = require("../model/chat.model");
const {
  decodeMessageCursor,
  encodeMessageCursor,
} = require("./messagePagination.service");

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 30;
const CONTEXT_SIDE_LIMIT = 15;

class MessageSearchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MessageSearchError";
    this.code = code;
    this.status = status;
  }
}

const normalizeSearchLimit = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_SEARCH_LIMIT;
  }
  if (!/^\d+$/.test(String(value))) {
    throw new MessageSearchError("INVALID_MESSAGE_SEARCH_LIMIT", "Giới hạn kết quả không hợp lệ");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new MessageSearchError(
      "INVALID_MESSAGE_SEARCH_LIMIT",
      `Giới hạn kết quả phải từ 1 đến ${MAX_SEARCH_LIMIT}`,
    );
  }
  return limit;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const messageBoundaryFilter = (boundary, direction) => ({
  $or: direction === "older"
    ? [
        { createdAt: { $lt: boundary.createdAt } },
        { createdAt: boundary.createdAt, _id: { $lt: boundary.id } },
      ]
    : [
        { createdAt: { $gt: boundary.createdAt } },
        { createdAt: boundary.createdAt, _id: { $gt: boundary.id } },
      ],
});

const populateMessageQuery = (query) => query
  .populate({ path: "user_id", select: "name avatar" })
  .populate({ path: "content_user", select: "name avatar" });

const searchRoomMessages = async ({ roomId, keyword, cursor, limit, chatModel = Chat }) => {
  if (!mongoose.isValidObjectId(roomId)) {
    throw new MessageSearchError("INVALID_MESSAGE_ROOM", "Phòng chat không hợp lệ");
  }
  const pageSize = normalizeSearchLimit(limit);
  const normalizedKeyword = keyword.normalize("NFC");
  const baseFilter = {
    room_chat_id: new mongoose.Types.ObjectId(roomId),
    deleted: { $ne: true },
    type: { $ne: "system" },
    content: { $regex: escapeRegex(normalizedKeyword), $options: "i" },
  };
  const filter = { ...baseFilter };
  if (cursor) Object.assign(filter, messageBoundaryFilter(decodeMessageCursor(cursor), "older"));

  const rows = await populateMessageQuery(
    chatModel
      .find(filter)
      .select("user_id room_chat_id content images files type createdAt clientMessageId")
      .sort({ createdAt: -1, _id: -1 })
      .limit(pageSize + 1),
  );
  const total = await chatModel.countDocuments(baseFilter);
  const selected = rows.slice(0, pageSize);
  const last = selected[selected.length - 1];

  return {
    messages: selected,
    total,
    pagination: {
      nextCursor: rows.length > pageSize && last ? encodeMessageCursor(last) : null,
      hasMore: rows.length > pageSize,
      limit: pageSize,
    },
  };
};

const getMessageContext = async ({ roomId, messageId, chatModel = Chat }) => {
  if (!mongoose.isValidObjectId(roomId) || !mongoose.isValidObjectId(messageId)) {
    throw new MessageSearchError("INVALID_MESSAGE_CONTEXT", "Tin nhắn không hợp lệ");
  }
  const roomObjectId = new mongoose.Types.ObjectId(roomId);
  const target = await populateMessageQuery(chatModel.findOne({
    _id: new mongoose.Types.ObjectId(messageId),
    room_chat_id: roomObjectId,
    deleted: { $ne: true },
  }));
  if (!target) {
    throw new MessageSearchError("MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn", 404);
  }

  const boundary = { createdAt: target.createdAt, id: target._id };
  const commonFilter = { room_chat_id: roomObjectId, deleted: { $ne: true } };
  const older = await populateMessageQuery(
    chatModel.find({ ...commonFilter, ...messageBoundaryFilter(boundary, "older") })
      .sort({ createdAt: -1, _id: -1 })
      .limit(CONTEXT_SIDE_LIMIT),
  );
  const newer = await populateMessageQuery(
    chatModel.find({ ...commonFilter, ...messageBoundaryFilter(boundary, "newer") })
      .sort({ createdAt: 1, _id: 1 })
      .limit(CONTEXT_SIDE_LIMIT),
  );

  return {
    messages: [...older].reverse().concat(target, newer),
    targetMessageId: target._id.toString(),
  };
};

module.exports = {
  CONTEXT_SIDE_LIMIT,
  MAX_SEARCH_LIMIT,
  MessageSearchError,
  escapeRegex,
  getMessageContext,
  normalizeSearchLimit,
  searchRoomMessages,
};
