const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const runMongoTransaction = require("../utils/mongoTransaction");
const {
  RoomAuthorizationError,
} = require("./roomAuthorization.service");
const {
  groupAdminMutationFilter,
} = require("./roomMutationAuthorization.service");

const editRoom = ({ roomId, actorId, updatedData }) =>
  runMongoTransaction(async (session) => {
    const room = await RoomChat.findOneAndUpdate(
      groupAdminMutationFilter(roomId, actorId),
      { $set: updatedData },
      { new: true, session },
    ).select("title avatar avatar_public_id");

    if (!room) {
      throw new RoomAuthorizationError(
        403,
        "ROOM_ADMIN_REQUIRED",
        "Bạn không còn quyền quản trị phòng chat này",
      );
    }

    const [systemMessage] = await Chat.create(
      [
        {
          room_chat_id: roomId,
          user_id: actorId,
          type: "system",
          action: "rename_group",
          content: room.title,
        },
      ],
      { session },
    );

    return { room, systemMessage };
  });

module.exports = { editRoom };
