const mongoose = require("mongoose");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");

class RoomAuthorizationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "RoomAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

const invalidIdError = (resource) =>
  new RoomAuthorizationError(
    400,
    `INVALID_${resource.toUpperCase()}_ID`,
    `${resource}Id không hợp lệ`,
  );

const assertObjectId = (value, resource) => {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw invalidIdError(resource);
  }
};

const requireRoomMember = async (roomId, userId) => {
  assertObjectId(roomId, "room");
  assertObjectId(userId?.toString(), "user");

  const room = await RoomChat.findById(roomId);
  if (!room) {
    throw new RoomAuthorizationError(
      404,
      "ROOM_NOT_FOUND",
      "Không tìm thấy phòng chat",
    );
  }

  const member = room.users.find(
    (item) => item.user_id?.toString() === userId.toString(),
  );
  if (!member) {
    throw new RoomAuthorizationError(
      403,
      "ROOM_ACCESS_DENIED",
      "Bạn không có quyền truy cập phòng chat này",
    );
  }

  return { member, room };
};

const requireGroupAdmin = async (roomId, userId) => {
  const access = await requireRoomMember(roomId, userId);

  if (access.room.typeRoom !== "group" || access.member.role !== "admin") {
    throw new RoomAuthorizationError(
      403,
      "ROOM_ADMIN_REQUIRED",
      "Bạn không có quyền quản trị phòng chat này",
    );
  }

  return access;
};

const requireRoomMembers = async (roomIds, userId) => {
  const authorizedRooms = await Promise.all(
    roomIds.map(async (roomId) => {
      const access = await requireRoomMember(roomId, userId);
      return [roomId, access.room];
    }),
  );

  return new Map(authorizedRooms);
};

const requireMessageOwner = async (messageId, roomId, userId) => {
  assertObjectId(messageId, "message");
  await requireRoomMember(roomId, userId);

  const message = await Chat.findOne({
    _id: messageId,
    room_chat_id: roomId,
    user_id: userId,
  });

  if (!message) {
    throw new RoomAuthorizationError(
      403,
      "MESSAGE_ACCESS_DENIED",
      "Bạn không có quyền thao tác tin nhắn này",
    );
  }

  return message;
};

const sendRoomAuthorizationError = (res, error) => {
  if (!(error instanceof RoomAuthorizationError)) return false;

  res.status(error.status).json({
    error: true,
    success: false,
    code: error.code,
    message: error.message,
  });
  return true;
};

module.exports = {
  RoomAuthorizationError,
  requireRoomMember,
  requireRoomMembers,
  requireGroupAdmin,
  requireMessageOwner,
  sendRoomAuthorizationError,
};
