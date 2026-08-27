const User = require("../model/user.model");
const RoomChat = require("../model/room-chat.model");
const runMongoTransaction = require("../utils/mongoTransaction");
const { createRoomDeletionJob } = require("./roomDeletion.service");

class FriendshipStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "FriendshipStateError";
    this.code = "FRIENDSHIP_STATE_CHANGED";
  }
}

const assertUpdated = (result) => {
  if (result.matchedCount !== 1) {
    throw new FriendshipStateError("Friendship state changed during operation");
  }
};

const addFriendRequest = (senderId, receiverId, message) =>
  runMongoTransaction(async (session) => {
    const receiverUpdate = await User.updateOne(
      { _id: receiverId, "acceptFriends.id": { $ne: senderId } },
      { $push: { acceptFriends: { id: senderId, message } } },
      { session },
    );
    assertUpdated(receiverUpdate);

    const senderUpdate = await User.updateOne(
      { _id: senderId, "requestFriends.id": { $ne: receiverId } },
      { $push: { requestFriends: { id: receiverId, message } } },
      { session },
    );
    assertUpdated(senderUpdate);
  });

const cancelFriendRequest = (senderId, receiverId) =>
  runMongoTransaction(async (session) => {
    await User.updateOne(
      { _id: receiverId },
      { $pull: { acceptFriends: { id: senderId } } },
      { session },
    );
    await User.updateOne(
      { _id: senderId },
      { $pull: { requestFriends: { id: receiverId } } },
      { session },
    );
  });

const refuseFriendRequest = (receiverId, senderId) =>
  cancelFriendRequest(senderId, receiverId);

const acceptFriendRequest = (receiverId, senderId) =>
  runMongoTransaction(async (session) => {
    const receiver = await User.findOne({
      _id: receiverId,
      "acceptFriends.id": senderId,
    }).session(session);
    const sender = await User.findOne({
      _id: senderId,
      "requestFriends.id": receiverId,
    }).session(session);

    if (!receiver || !sender) {
      throw new FriendshipStateError("Friend request no longer exists");
    }

    const [roomChat] = await RoomChat.create(
      [
        {
          typeRoom: "friend",
          users: [
            { user_id: senderId, role: "superAdmin" },
            { user_id: receiverId, role: "superAdmin" },
          ],
        },
      ],
      { session },
    );

    const receiverUpdate = await User.updateOne(
      { _id: receiverId, "acceptFriends.id": senderId },
      {
        $pull: { acceptFriends: { id: senderId } },
        $addToSet: {
          FriendList: { user_id: senderId, room_chat_id: roomChat._id },
        },
      },
      { session },
    );
    assertUpdated(receiverUpdate);

    const senderUpdate = await User.updateOne(
      { _id: senderId, "requestFriends.id": receiverId },
      {
        $pull: { requestFriends: { id: receiverId } },
        $addToSet: {
          FriendList: { user_id: receiverId, room_chat_id: roomChat._id },
        },
      },
      { session },
    );
    assertUpdated(senderUpdate);

    return roomChat;
  });

const unfriend = (currentUserId, friendId) =>
  runMongoTransaction(async (session) => {
    const currentUser = await User.findOne({
      _id: currentUserId,
      "FriendList.user_id": friendId,
    })
      .select("FriendList")
      .session(session);
    const friendship = currentUser?.FriendList.find(
      (item) => item.user_id.toString() === friendId.toString(),
    );

    if (!friendship) {
      throw new FriendshipStateError("Friendship no longer exists");
    }

    const roomChatId = friendship.room_chat_id;
    const room = await RoomChat.findOne({
      _id: roomChatId,
      typeRoom: "friend",
      "users.user_id": { $all: [currentUserId, friendId] },
    }).session(session);
    if (!room) {
      throw new FriendshipStateError("Friend room no longer exists");
    }
    const currentUserUpdate = await User.updateOne(
      { _id: currentUserId, "FriendList.user_id": friendId },
      { $pull: { FriendList: { user_id: friendId } } },
      { session },
    );
    assertUpdated(currentUserUpdate);

    const friendUpdate = await User.updateOne(
      { _id: friendId, "FriendList.user_id": currentUserId },
      { $pull: { FriendList: { user_id: currentUserId } } },
      { session },
    );
    assertUpdated(friendUpdate);

    await createRoomDeletionJob(room, session);
    const roomDeletion = await RoomChat.deleteOne(
      {
        _id: roomChatId,
        typeRoom: "friend",
        "users.user_id": { $all: [currentUserId, friendId] },
      },
      { session },
    );
    if (roomDeletion.deletedCount !== 1) {
      throw new FriendshipStateError("Friend room changed during operation");
    }
    return roomChatId;
  });

module.exports = {
  FriendshipStateError,
  acceptFriendRequest,
  addFriendRequest,
  cancelFriendRequest,
  refuseFriendRequest,
  unfriend,
};
