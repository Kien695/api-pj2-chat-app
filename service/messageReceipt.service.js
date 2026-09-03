const mongoose = require("mongoose");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const RoomMessageReceipt = require("../model/room-message-receipt.model");

const RECEIPT_STATUSES = new Set(["delivered", "read"]);
const MAX_CAS_ATTEMPTS = 5;

class MessageReceiptError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "MessageReceiptError";
    this.status = status;
    this.code = code;
  }
}

const invalidReceipt = (code, message) =>
  new MessageReceiptError(400, code, message);

const normalizeMessageReceiptInput = ({ roomId, messageId, status }) => {
  if (typeof roomId !== "string" || !mongoose.Types.ObjectId.isValid(roomId)) {
    throw invalidReceipt("INVALID_RECEIPT_ROOM", "Phòng chat không hợp lệ");
  }
  if (typeof messageId !== "string" || !mongoose.Types.ObjectId.isValid(messageId)) {
    throw invalidReceipt("INVALID_RECEIPT_MESSAGE", "Tin nhắn không hợp lệ");
  }
  if (!RECEIPT_STATUSES.has(status)) {
    throw invalidReceipt("INVALID_RECEIPT_STATUS", "Trạng thái tin nhắn không hợp lệ");
  }
  return {
    roomId: new mongoose.Types.ObjectId(roomId),
    messageId: new mongoose.Types.ObjectId(messageId),
    status,
  };
};

const isBoundaryAfter = (message, boundaryCreatedAt, boundaryMessageId) => {
  if (!boundaryCreatedAt || !boundaryMessageId) return true;
  const messageTime = new Date(message.createdAt).getTime();
  const boundaryTime = new Date(boundaryCreatedAt).getTime();
  if (messageTime !== boundaryTime) return messageTime > boundaryTime;
  return message._id.toString() > boundaryMessageId.toString();
};

const buildReceiptAdvance = ({ receipt, message, status, now }) => {
  const deliveredAdvances = isBoundaryAfter(
    message,
    receipt?.lastDeliveredMessageCreatedAt,
    receipt?.lastDeliveredMessageId,
  );
  const readAdvances = status === "read" && isBoundaryAfter(
    message,
    receipt?.lastReadMessageCreatedAt,
    receipt?.lastReadMessageId,
  );
  const set = {};
  if (deliveredAdvances) {
    set.lastDeliveredMessageId = message._id;
    set.lastDeliveredMessageCreatedAt = message.createdAt;
    set.deliveredAt = now;
  }
  if (readAdvances) {
    set.lastReadMessageId = message._id;
    set.lastReadMessageCreatedAt = message.createdAt;
    set.readAt = now;
  }
  return set;
};

const checkpointFilter = (receipt) => ({
  _id: receipt._id,
  lastDeliveredMessageId: receipt.lastDeliveredMessageId || { $exists: false },
  lastReadMessageId: receipt.lastReadMessageId || { $exists: false },
});

const hydrateDeliveredReceipts = async ({
  messages,
  roomId,
  senderUserId,
  receiptModel = RoomMessageReceipt,
}) => {
  if (!Array.isArray(messages)) throw new TypeError("Messages must be an array");
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    throw invalidReceipt("INVALID_RECEIPT_ROOM", "PhÃ²ng chat khÃ´ng há»£p lá»‡");
  }
  if (!mongoose.Types.ObjectId.isValid(senderUserId)) {
    throw invalidReceipt("INVALID_RECEIPT_USER", "NgÆ°á»i dÃ¹ng khÃ´ng há»£p lá»‡");
  }

  const receipts = await receiptModel
    .find({
      roomId: new mongoose.Types.ObjectId(roomId),
      lastDeliveredMessageId: { $exists: true },
    })
    .select(
      "userId lastDeliveredMessageId lastDeliveredMessageCreatedAt lastReadMessageId lastReadMessageCreatedAt",
    )
    .lean();
  const senderId = senderUserId.toString();

  return messages.map((messageDocument) => {
    const message =
      typeof messageDocument.toObject === "function"
        ? messageDocument.toObject()
        : { ...messageDocument };
    const messageSenderId = message.user_id?._id || message.user_id;
    if (message.type === "system" || messageSenderId?.toString() !== senderId) {
      return message;
    }

    const deliveredBy = receipts
      .filter(
        (receipt) =>
          receipt.userId.toString() !== senderId &&
          !isBoundaryAfter(
            message,
            receipt.lastDeliveredMessageCreatedAt,
            receipt.lastDeliveredMessageId,
          ),
      )
      .map((receipt) => receipt.userId.toString());

    const readBy = receipts
      .filter(
        (receipt) =>
          receipt.lastReadMessageId &&
          receipt.lastReadMessageCreatedAt &&
          receipt.userId.toString() !== senderId &&
          !isBoundaryAfter(
            message,
            receipt.lastReadMessageCreatedAt,
            receipt.lastReadMessageId,
          ),
      )
      .map((receipt) => receipt.userId.toString());

    return {
      ...message,
      deliveryStatus:
        readBy.length > 0
          ? "read"
          : deliveredBy.length > 0
            ? "delivered"
            : "sent",
      deliveredBy,
      readBy,
    };
  });
};

const recordMessageReceipt = async ({
  roomId,
  userId,
  messageId,
  status,
  now = new Date(),
  chatModel = Chat,
  roomModel = RoomChat,
  receiptModel = RoomMessageReceipt,
}) => {
  const normalized = normalizeMessageReceiptInput({ roomId, messageId, status });
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw invalidReceipt("INVALID_RECEIPT_USER", "Người dùng không hợp lệ");
  }
  const actorId = new mongoose.Types.ObjectId(userId);
  const membership = await roomModel.exists({
    _id: normalized.roomId,
    "users.user_id": actorId,
  });
  if (!membership) {
    throw new MessageReceiptError(403, "ROOM_ACCESS_DENIED", "Bạn không còn quyền truy cập phòng chat này");
  }

  const message = await chatModel
    .findOne({ _id: normalized.messageId, room_chat_id: normalized.roomId })
    .select("_id user_id createdAt");
  if (!message) {
    throw new MessageReceiptError(404, "RECEIPT_MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn trong phòng");
  }
  if (message.user_id?.toString() === actorId.toString()) {
    throw invalidReceipt("OWN_MESSAGE_RECEIPT_NOT_ALLOWED", "Không thể xác nhận tin nhắn của chính mình");
  }

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const receipt = await receiptModel.findOne({ roomId: normalized.roomId, userId: actorId });
    const set = buildReceiptAdvance({ receipt, message, status, now });
    if (Object.keys(set).length === 0) return { advanced: false, message, receipt };

    if (!receipt) {
      try {
        const created = await receiptModel.create({ roomId: normalized.roomId, userId: actorId, ...set });
        return { advanced: true, message, receipt: created };
      } catch (error) {
        if (error?.code !== 11000) throw error;
        continue;
      }
    }

    const result = await receiptModel.updateOne(checkpointFilter(receipt), { $set: set });
    if (result.modifiedCount === 1) {
      return { advanced: true, message, receipt: { ...receipt.toObject(), ...set } };
    }
  }

  throw new MessageReceiptError(409, "RECEIPT_UPDATE_CONFLICT", "Không thể cập nhật trạng thái tin nhắn");
};

module.exports = {
  MessageReceiptError,
  buildReceiptAdvance,
  hydrateDeliveredReceipts,
  isBoundaryAfter,
  normalizeMessageReceiptInput,
  recordMessageReceipt,
};
