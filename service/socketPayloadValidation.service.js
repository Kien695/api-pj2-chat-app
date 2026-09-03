const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_FRIEND_REQUEST_MESSAGE_LENGTH = 500;

class SocketPayloadValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SocketPayloadValidationError";
    this.code = code;
  }
}

const invalidPayload = (code, message) => {
  throw new SocketPayloadValidationError(code, message);
};

const validateObjectId = (value, code, message) => {
  if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) {
    invalidPayload(code, message);
  }
  return value.toLowerCase();
};

const validateFriendTarget = (targetUserId, actorUserId) => {
  const normalizedTargetId = validateObjectId(
    targetUserId,
    "INVALID_FRIEND_USER_ID",
    "Mã người dùng không hợp lệ",
  );
  if (normalizedTargetId === String(actorUserId).toLowerCase()) {
    invalidPayload(
      "SELF_FRIEND_ACTION_NOT_ALLOWED",
      "Không thể thực hiện thao tác kết bạn với chính mình",
    );
  }
  return normalizedTargetId;
};

const validateFriendRequestPayload = (payload, actorUserId) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidPayload("INVALID_FRIEND_REQUEST", "Lời mời kết bạn không hợp lệ");
  }

  const userId = validateFriendTarget(payload.userId, actorUserId);
  const text = payload.text === undefined ? "" : payload.text;
  if (
    typeof text !== "string" ||
    text.length > MAX_FRIEND_REQUEST_MESSAGE_LENGTH
  ) {
    invalidPayload(
      "INVALID_FRIEND_REQUEST_MESSAGE",
      "Nội dung lời mời kết bạn không hợp lệ",
    );
  }

  return { userId, text: text.trim() };
};

const validateRoomActionPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidPayload("INVALID_ROOM_PAYLOAD", "Dữ liệu phòng chat không hợp lệ");
  }
  return {
    roomChatId: validateObjectId(
      payload.roomChatId,
      "INVALID_ROOM_ID",
      "Mã phòng chat không hợp lệ",
    ),
  };
};

const validateMessageRemovalPayload = (payload) => {
  const { roomChatId } = validateRoomActionPayload(payload);
  return {
    roomChatId,
    selectedMessageId: validateObjectId(
      payload.selectedMessageId,
      "INVALID_MESSAGE_ID",
      "Mã tin nhắn không hợp lệ",
    ),
  };
};

const validateMessageReceiptPayload = (payload) => {
  const { roomChatId } = validateRoomActionPayload(payload);
  return {
    roomChatId,
    messageId: validateObjectId(
      payload.messageId,
      "INVALID_MESSAGE_ID",
      "MÃ£ tin nháº¯n khÃ´ng há»£p lá»‡",
    ),
  };
};

const validateTypingPayload = (value) => {
  if (typeof value !== "boolean") {
    invalidPayload("INVALID_TYPING_STATE", "Trạng thái nhập tin không hợp lệ");
  }
  return value;
};

module.exports = {
  MAX_FRIEND_REQUEST_MESSAGE_LENGTH,
  SocketPayloadValidationError,
  validateFriendRequestPayload,
  validateFriendTarget,
  validateMessageReceiptPayload,
  validateMessageRemovalPayload,
  validateObjectId,
  validateRoomActionPayload,
  validateTypingPayload,
};
