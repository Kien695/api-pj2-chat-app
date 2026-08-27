const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const runMongoTransaction = require("../utils/mongoTransaction");
const {
  RoomAuthorizationError,
} = require("./roomAuthorization.service");
const {
  groupAdminMutationFilter,
} = require("./roomMutationAuthorization.service");

const mutationDenied = () =>
  new RoomAuthorizationError(
    403,
    "ROOM_MUTATION_DENIED",
    "Quyền hoặc trạng thái thành viên phòng đã thay đổi",
  );

const addMembers = ({ roomId, actorId, memberIds }) =>
  runMongoTransaction(async (session) => {
    const userObjects = memberIds.map((memberId) => ({
      user_id: memberId,
      role: "member",
    }));
    const room = await RoomChat.findOneAndUpdate(
      groupAdminMutationFilter(roomId, actorId, [
        { "users.user_id": { $nin: memberIds } },
      ]),
      { $push: { users: { $each: userObjects } } },
      { new: true, session },
    );
    if (!room) throw mutationDenied();

    const [systemMessage] = await Chat.create(
      [
        {
          room_chat_id: roomId,
          user_id: actorId,
          type: "system",
          action: "add_member",
          content_user: memberIds,
        },
      ],
      { session },
    );
    return { room, systemMessage };
  });

const removeMember = ({ roomId, actorId, memberId }) =>
  runMongoTransaction(async (session) => {
    const room = await RoomChat.findOneAndUpdate(
      groupAdminMutationFilter(roomId, actorId, [
        {
          users: {
            $elemMatch: { user_id: memberId, role: { $ne: "admin" } },
          },
        },
      ]),
      { $pull: { users: { user_id: memberId } } },
      { new: true, session },
    );
    if (!room) throw mutationDenied();

    const [systemMessage] = await Chat.create(
      [
        {
          room_chat_id: roomId,
          user_id: actorId,
          type: "system",
          action: "remove_member",
          content_user: memberId,
        },
      ],
      { session },
    );
    return { room, systemMessage };
  });

const leaveGroup = ({ roomId, userId }) =>
  runMongoTransaction(async (session) => {
    const room = await RoomChat.findOneAndUpdate(
      {
        _id: roomId,
        typeRoom: "group",
        users: {
          $elemMatch: { user_id: userId, role: { $ne: "admin" } },
        },
      },
      { $pull: { users: { user_id: userId } } },
      { new: true, session },
    );
    if (!room) throw mutationDenied();

    const [systemMessage] = await Chat.create(
      [
        {
          room_chat_id: roomId,
          user_id: userId,
          type: "system",
          action: "leave_group",
          content_user: userId,
        },
      ],
      { session },
    );
    return { room, systemMessage };
  });

module.exports = {
  addMembers,
  leaveGroup,
  removeMember,
};
