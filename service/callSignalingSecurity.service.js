const mongoose = require("mongoose");
const RoomChat = require("../model/room-chat.model");

const MAX_SIGNAL_BYTES = 256 * 1024;
const CALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class CallSignalingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "CallSignalingError";
    this.status = status;
    this.code = code;
  }
}

const invalidCall = (code, message) => {
  throw new CallSignalingError(400, code, message);
};

const validateSignal = (signal) => {
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
    invalidCall("INVALID_CALL_SIGNAL", "Dữ liệu signaling không hợp lệ");
  }
  let serialized;
  try {
    serialized = JSON.stringify(signal);
  } catch {
    invalidCall("INVALID_CALL_SIGNAL", "Dữ liệu signaling không hợp lệ");
  }
  if (!serialized || Buffer.byteLength(serialized, "utf8") > MAX_SIGNAL_BYTES) {
    invalidCall("CALL_SIGNAL_TOO_LARGE", "Dữ liệu signaling vượt quá giới hạn");
  }
  return signal;
};

const validateCallTarget = (targetId, actorId) => {
  if (!mongoose.isValidObjectId(targetId)) {
    invalidCall("INVALID_CALL_TARGET", "Người nhận cuộc gọi không hợp lệ");
  }
  if (targetId.toString() === actorId.toString()) {
    invalidCall("SELF_CALL_NOT_ALLOWED", "Không thể tự gọi cho chính mình");
  }
  return targetId.toString();
};

const validateCallRequest = (payload, actorId) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidCall("INVALID_CALL_REQUEST", "Yêu cầu cuộc gọi không hợp lệ");
  }
  if (!["audio", "video"].includes(payload.type)) {
    invalidCall("INVALID_CALL_TYPE", "Loại cuộc gọi không hợp lệ");
  }
  return {
    calleeId: validateCallTarget(payload.callToUserId, actorId),
    signal: validateSignal(payload.signalData),
    type: payload.type,
  };
};

const validateCallResponse = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidCall("INVALID_CALL_RESPONSE", "Phản hồi cuộc gọi không hợp lệ");
  }
  if (typeof payload.callId !== "string" || !CALL_ID_PATTERN.test(payload.callId)) {
    invalidCall("INVALID_CALL_ID", "Mã cuộc gọi không hợp lệ");
  }
  return { callId: payload.callId, signal: validateSignal(payload.signal) };
};

const validateCallAction = (payload) => {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.callId !== "string" ||
    !CALL_ID_PATTERN.test(payload.callId)
  ) {
    invalidCall("INVALID_CALL_ID", "Mã cuộc gọi không hợp lệ");
  }
  return payload.callId;
};

const requireCallPermission = async (
  callerId,
  calleeId,
  roomModel = RoomChat,
) => {
  const room = await roomModel.exists({
    typeRoom: "friend",
    "users.user_id": { $all: [callerId, calleeId] },
  });
  if (!room) {
    throw new CallSignalingError(
      403,
      "CALL_PERMISSION_DENIED",
      "Chỉ có thể gọi cho người đang trong danh sách bạn bè",
    );
  }
};

module.exports = {
  CallSignalingError,
  requireCallPermission,
  validateCallAction,
  validateCallRequest,
  validateCallResponse,
};
