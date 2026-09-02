const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const runMongoTransaction = require("../utils/mongoTransaction");
const {
  consumeUploadCleanupLeases,
} = require("./uploadCleanupLease.service");
const {
  RoomAuthorizationError,
} = require("./roomAuthorization.service");

const findExistingMessage = (roomId, userId, clientMessageId) =>
  Chat.findOne({
    room_chat_id: roomId,
    user_id: userId,
    clientMessageId,
  });

const persistMessage = async ({
  roomId,
  userId,
  clientMessageId,
  content,
  images = [],
  files = [],
  type,
}) => {
  const existingMessage = await findExistingMessage(
    roomId,
    userId,
    clientMessageId,
  );
  if (existingMessage) {
    const room = await RoomChat.findOne({
      _id: roomId,
      "users.user_id": userId,
    });
    if (!room) {
      throw new RoomAuthorizationError(
        403,
        "ROOM_ACCESS_DENIED",
        "Bạn không còn quyền truy cập phòng chat này",
      );
    }
    return { message: existingMessage, room, duplicate: true };
  }

  try {
    return await runMongoTransaction(async (session) => {
      const room = await RoomChat.findOne({
        _id: roomId,
        "users.user_id": userId,
      }).session(session);

      if (!room) {
        throw new RoomAuthorizationError(
          403,
          "ROOM_ACCESS_DENIED",
          "Bạn không còn quyền truy cập phòng chat này",
        );
      }

      const now = new Date();
      const unreadIncrement = {};
      room.users.forEach((member) => {
        const memberId = member.user_id.toString();
        if (memberId !== userId.toString()) {
          unreadIncrement[`unreadCount.${memberId}`] = 1;
        }
      });

      await consumeUploadCleanupLeases({
        files: [...images, ...files].filter((asset) => asset.cleanup_job_id),
        userId,
        session,
      });

      const [savedMessage] = await Chat.create(
        [
          {
            user_id: userId,
            room_chat_id: roomId,
            clientMessageId,
            content,
            images,
            files,
            type,
            createdAt: now,
          },
        ],
        { session },
      );

      const updatedRoom = await RoomChat.findOneAndUpdate(
        { _id: roomId, "users.user_id": userId },
        {
          lastMessage: {
            content,
            images,
            files,
            sender: userId,
            createdAt: now,
            type,
          },
          $inc: unreadIncrement,
          $set: { [`unreadCount.${userId.toString()}`]: 0 },
        },
        { new: true, session },
      );

      if (!updatedRoom) {
        throw new RoomAuthorizationError(
          403,
          "ROOM_ACCESS_DENIED",
          "Bạn không còn quyền truy cập phòng chat này",
        );
      }

      return { message: savedMessage, room: updatedRoom, duplicate: false };
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const duplicateMessage = await findExistingMessage(
      roomId,
      userId,
      clientMessageId,
    );
    const room = await RoomChat.findOne({
      _id: roomId,
      "users.user_id": userId,
    });
    if (!duplicateMessage || !room) throw error;
    return { message: duplicateMessage, room, duplicate: true };
  }
};

module.exports = {
  persistMessage,
};
