const mongoose = require("mongoose");
const Chat = require("../model/chat.model");

const DEFAULT_MESSAGE_PAGE_SIZE = 30;
const MAX_MESSAGE_PAGE_SIZE = 50;
const MAX_CURSOR_LENGTH = 512;

class MessagePaginationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MessagePaginationError";
    this.status = 400;
    this.code = code;
  }
}

const normalizeMessagePageSize = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_MESSAGE_PAGE_SIZE;
  }
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+$/.test(String(value))
  ) {
    throw new MessagePaginationError(
      "Giới hạn tin nhắn không hợp lệ",
      "INVALID_MESSAGE_LIMIT",
    );
  }

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MESSAGE_PAGE_SIZE) {
    throw new MessagePaginationError(
      `Giới hạn tin nhắn phải từ 1 đến ${MAX_MESSAGE_PAGE_SIZE}`,
      "INVALID_MESSAGE_LIMIT",
    );
  }
  return limit;
};

const normalizeCursorBoundary = ({ createdAt, id }) => {
  const date = new Date(createdAt);
  if (
    typeof createdAt !== "string" ||
    Number.isNaN(date.getTime()) ||
    typeof id !== "string" ||
    !/^[a-f\d]{24}$/i.test(id) ||
    !mongoose.Types.ObjectId.isValid(id)
  ) {
    throw new MessagePaginationError(
      "Cursor tin nhắn không hợp lệ",
      "INVALID_MESSAGE_CURSOR",
    );
  }

  return {
    createdAt: date,
    id: new mongoose.Types.ObjectId(id),
  };
};

const encodeMessageCursor = (message) => {
  const boundary = normalizeCursorBoundary({
    createdAt: new Date(message?.createdAt).toISOString(),
    id: message?._id?.toString(),
  });
  return Buffer.from(
    JSON.stringify({
      createdAt: boundary.createdAt.toISOString(),
      id: boundary.id.toString(),
    }),
    "utf8",
  ).toString("base64url");
};

const decodeMessageCursor = (cursor) => {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z\d_-]+$/.test(cursor)
  ) {
    throw new MessagePaginationError(
      "Cursor tin nhắn không hợp lệ",
      "INVALID_MESSAGE_CURSOR",
    );
  }

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !value ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "createdAt,id"
    ) {
      throw new Error("Unexpected cursor shape");
    }
    return normalizeCursorBoundary(value);
  } catch (error) {
    if (error instanceof MessagePaginationError) throw error;
    throw new MessagePaginationError(
      "Cursor tin nhắn không hợp lệ",
      "INVALID_MESSAGE_CURSOR",
    );
  }
};

const getMessagePage = async ({
  roomId,
  cursor,
  limit,
  chatModel = Chat,
}) => {
  if (typeof roomId !== "string" || !mongoose.Types.ObjectId.isValid(roomId)) {
    throw new MessagePaginationError(
      "Phòng chat không hợp lệ",
      "INVALID_MESSAGE_ROOM",
    );
  }

  const pageSize = normalizeMessagePageSize(limit);
  const roomObjectId = new mongoose.Types.ObjectId(roomId);
  const filter = { room_chat_id: roomObjectId };

  if (cursor !== undefined && cursor !== null && cursor !== "") {
    const boundary = decodeMessageCursor(cursor);
    filter.$or = [
      { createdAt: { $lt: boundary.createdAt } },
      { createdAt: boundary.createdAt, _id: { $lt: boundary.id } },
    ];
  }

  const rows = await chatModel
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .populate({ path: "user_id", select: "name avatar " })
    .populate({ path: "content_user", select: "name avatar " });

  const hasMore = rows.length > pageSize;
  const selected = rows.slice(0, pageSize);
  const oldestSelected = selected[selected.length - 1];

  return {
    messages: [...selected].reverse(),
    pagination: {
      nextCursor:
        hasMore && oldestSelected ? encodeMessageCursor(oldestSelected) : null,
      hasMore,
      limit: pageSize,
    },
  };
};

module.exports = {
  DEFAULT_MESSAGE_PAGE_SIZE,
  MAX_MESSAGE_PAGE_SIZE,
  MessagePaginationError,
  decodeMessageCursor,
  encodeMessageCursor,
  getMessagePage,
  normalizeMessagePageSize,
};
