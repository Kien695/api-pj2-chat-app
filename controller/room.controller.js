const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const User = require("../model/user.model");
const RoomChat = require("../model/room-chat.model");
const Chat = require("../model/chat.model");
const { getIO } = require("../socket");
const {
  addMembers: addRoomMembers,
  leaveGroup: leaveRoomGroup,
  removeMember: removeRoomMember,
} = require("../service/roomMembershipMutation.service");
const {
  sendRoomAuthorizationError,
} = require("../service/roomAuthorization.service");
const { deleteRoom } = require("../service/roomDeletion.service");
const { editRoom } = require("../service/roomEdit.service");
const { cleanupAssets } = require("../service/cloudinaryAsset.service");
const {
  enqueueMediaCleanup,
  triggerMediaCleanupWorker,
} = require("../service/mediaCleanupJob.service");
const { sendInternalServerError } = require("../utils/httpErrorResponse");

module.exports.createRoomChat = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const { title, members } = req.body;

    if (
      !Array.isArray(members) ||
      members.length === 0 ||
      members.length > 100 ||
      members.some(
        (memberId) =>
          typeof memberId !== "string" ||
          !mongoose.Types.ObjectId.isValid(memberId),
      ) ||
      (title !== undefined &&
        (typeof title !== "string" || title.trim().length > 100))
    ) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Thông tin phòng chat không hợp lệ",
      });
    }

    const uniqueMemberIds = [
      ...new Set(
        members.filter(
          (memberId) => memberId.toString() !== userId.toString(),
        ),
      ),
    ];
    const existingUsers = await User.find({
      _id: { $in: uniqueMemberIds },
    }).select("_id");

    if (existingUsers.length !== uniqueMemberIds.length) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Danh sách thành viên không hợp lệ",
      });
    }

    const inviteToken = randomUUID();
    const dataRoom = {
      title: title?.trim() || "",
      typeRoom: "group",
      inviteToken: inviteToken,
      users: [],
    };
    for (const memberId of uniqueMemberIds) {
      dataRoom.users.push({ user_id: memberId, role: "member" });
    }
    dataRoom.users.push({ user_id: userId, role: "admin" });

    const roomChat = new RoomChat(dataRoom);
    await roomChat.save();

    const io = getIO();
    roomChat.users.forEach((member) => {
      io.to(member.user_id.toString()).emit("SERVER_RETURN_NEW_ROOM", roomChat);
    });

    return res.status(200).json({
      message: "Phòng chat được tạo thành công",
      error: false,
      success: true,
      data: roomChat,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Create room failed");
  }
};

module.exports.getRoomChat = async (req, res) => {
  try {
    const objectId = new mongoose.Types.ObjectId(res.locals.userId);
    const rooms = await RoomChat.find({
      typeRoom: "group",
      "users.user_id": objectId,
    });

    return res.status(200).json({
      error: false,
      success: true,
      data: rooms,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Get rooms failed");
  }
};

module.exports.getAllRoomChat = async (req, res) => {
  try {
    const objectId = new mongoose.Types.ObjectId(res.locals.userId);

    const roomChat = await RoomChat.find({
      "users.user_id": objectId,
    })
      .sort({ createdAt: -1 })
      .populate({
        path: "users.user_id",
        select:
          "-password -refresh_token -googleId -FriendList -requestFriends -acceptFriends",
      });

    if (roomChat) {
      return res.status(200).json({
        success: true,
        data: roomChat,
      });
    }
  } catch (error) {
    return sendInternalServerError(res, error, "Get all rooms failed");
  }
};

module.exports.editRoomChat = async (req, res) => {
  let roomImageCommitted = false;
  try {
    const roomChatId = req.params.id;
    const { title } = req.body;
    const roomChat = res.locals.roomChat;

    if (
      title !== undefined &&
      (typeof title !== "string" || title.trim().length > 100)
    ) {
      await cleanupAssets(req.uploadedCloudinaryAssets).catch(() => {});
      return res.status(400).json({
        success: false,
        error: true,
        message: "Tên phòng chat không hợp lệ",
      });
    }
    const updatedData = {};
    if (title?.trim()) updatedData.title = title.trim();
    if (req.body.image && req.body.image_id) {
      updatedData.avatar = req.body.image;
      updatedData.avatar_public_id = req.body.image_id;
    }
    const mutation = await editRoom({
      roomId: roomChatId,
      actorId: res.locals.userId,
      updatedData,
    });
    const roomChatUpdated = mutation.room;
    roomImageCommitted = Boolean(req.body.image);

    if (req.body.image && roomChat.avatar_public_id) {
      enqueueMediaCleanup([
        { public_id: roomChat.avatar_public_id, resource_type: "image" },
      ]).catch((cleanupError) => {
        console.error("Previous room image cleanup enqueue failed", cleanupError);
      });
    }

    try {
      const populatedMsg = await Chat.findById(
        mutation.systemMessage._id,
      ).populate("user_id", "name");
      const io = getIO();
      io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
      io.to(roomChatId).emit("SERVER_ROOM_UPDATED", {
        title: roomChatUpdated.title,
        avatar: roomChatUpdated.avatar,
      });
    } catch (notificationError) {
      console.error("Room edit notification failed", {
        roomChatId,
        error: notificationError,
      });
    }

    return res.status(200).json({
      success: true,
      error: false,
      data: roomChatUpdated,
    });
  } catch (error) {
    if (!roomImageCommitted) {
      await cleanupAssets(req.uploadedCloudinaryAssets).catch(
        (cleanupError) => {
          console.error("Room image compensation failed", cleanupError);
        },
      );
    }
    if (sendRoomAuthorizationError(res, error)) return;
    return sendInternalServerError(res, error, "Edit room failed");
  }
};

module.exports.addMember = async (req, res) => {
  try {
    const roomChatId = req.params.id;
    const members = req.body.members;

    if (
      !Array.isArray(members) ||
      members.length === 0 ||
      members.length > 100 ||
      members.some(
        (memberId) =>
          typeof memberId !== "string" ||
          !mongoose.Types.ObjectId.isValid(memberId),
      )
    ) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Danh sách thành viên không hợp lệ",
      });
    }

    const room = res.locals.roomChat;
    const existingIds = room.users.map((u) => u.user_id.toString());
    const newMemberIds = [...new Set(members)]
      .filter((id) => !existingIds.includes(id.toString()))
      .filter((id) => id.toString() !== res.locals.userId.toString());
    const existingUsers = await User.find({
      _id: { $in: newMemberIds },
    }).select("_id");

    if (existingUsers.length !== newMemberIds.length) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Danh sách thành viên không hợp lệ",
      });
    }

    if (newMemberIds.length > 0) {
      const mutation = await addRoomMembers({
        roomId: roomChatId,
        actorId: res.locals.userId,
        memberIds: newMemberIds,
      });

      const newUsers = await User.find(
        { _id: { $in: newMemberIds } },
        "name avatar lastActive",
      );
      const updatedRoom = await RoomChat.findById(roomChatId).populate(
        "users.user_id",
        "name avatar lastActive",
      );
      const populatedMsg = await Chat.findById(mutation.systemMessage._id)
        .populate("user_id", "name")
        .populate("content_user", "name");
      const io = getIO();

      io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
      io.to(roomChatId).emit("SERVER_ROOM_UPDATED_USER", {
        users: newUsers.map((newUser) => ({
          user_id: newUser,
          role: "member",
        })),
      });
      newMemberIds.forEach((newMemberId) => {
        io.to(newMemberId.toString()).emit("SERVER_ROOM_UPDATED_SIDEBAR", {
          roomChat: updatedRoom,
        });
      });
    }

    return res.status(200).json({
      error: false,
      success: true,
    });
  } catch (error) {
    if (sendRoomAuthorizationError(res, error)) return;
    return sendInternalServerError(res, error, "Add room members failed");
  }
};

module.exports.removeMember = async (req, res) => {
  try {
    const memberId = req.body.memberId;
    const roomChatId = req.params.id;
    const currentUserId = res.locals.userId; // user đang đăng nhập

    const roomChat = await RoomChat.findById(roomChatId);
    if (!roomChat) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy phòng chat",
      });
    }

    // 1️ Check user hiện tại có phải admin không
    const currentUser = roomChat.users.find(
      (u) => u.user_id.toString() === currentUserId,
    );

    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Bạn không có quyền xóa thành viên",
      });
    }

    // 2️ Kiểm tra thành viên tồn tại trong nhóm
    const member = roomChat.users.find(
      (u) => u.user_id.toString() === memberId,
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Thành viên không tồn tại trong nhóm",
      });
    }

    if (member.role === "admin") {
      return res.status(400).json({
        success: false,
        message: "Không thể xóa trưởng nhóm",
      });
    }

    // 3️ Xóa member khỏi nhóm
    let mutation;
    try {
      mutation = await removeRoomMember({
        roomId: roomChatId,
        actorId: currentUserId,
        memberId,
      });
    } catch (error) {
      if (sendRoomAuthorizationError(res, error)) return;
      throw error;
    }

    const updatedRoom = await RoomChat.findById(roomChatId)
      .select("title typeRoom avatar users")
      .populate({
        path: "users.user_id",
        select: "name avatar lastActive",
      });
    const populatedMsg = await Chat.findById(mutation.systemMessage._id)
      .populate("user_id", "name")
      .populate("content_user", "name");
    const io = getIO();

    io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
    io.to(roomChatId).emit("SERVER_ROOM_REMOVE_USERS", {
      roomChatId,
      users: updatedRoom.users,
      removedUserId: memberId,
      action: "remove",
    });
    io.to(memberId.toString()).emit("SERVER_LEAVE_ROOM_PERSON", {
      roomChatId,
    });
    io.in(memberId.toString()).socketsLeave(roomChatId);

    return res.status(200).json({
      success: true,
      message: "Xóa thành viên khỏi nhóm thành công",
      error: false,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Remove room member failed");
  }
};

module.exports.leaveGroup = async (req, res) => {
  try {
    const roomChatId = req.params.id;
    const currentUserId = res.locals.userId; // user đang đăng nhập

    const roomChat = await RoomChat.findById(roomChatId);
    if (!roomChat) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy phòng chat",
      });
    }

    // 1 Kiểm tra thành viên tồn tại trong nhóm
    const member = roomChat.users.find(
      (u) => u.user_id.toString() === currentUserId,
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Bạn không tồn tại trong nhóm",
      });
    }

    if (member.role === "admin") {
      return res.status(400).json({
        success: false,
        message: "Bạn phải ủy quyền nhóm trưởng trước khi rời nhóm",
      });
    }

    // 3️ Xóa member khỏi nhóm
    const mutation = await leaveRoomGroup({
      roomId: roomChatId,
      userId: currentUserId,
    });

    const updatedRoom = await RoomChat.findById(roomChatId)
      .select("title typeRoom avatar users")
      .populate({
        path: "users.user_id",
        select: "name avatar lastActive",
      });
    const populatedMsg = await Chat.findById(mutation.systemMessage._id)
      .populate("user_id", "name")
      .populate("content_user", "name");
    const io = getIO();

    io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
    io.to(roomChatId).emit("SERVER_ROOM_REMOVE_USERS", {
      roomChatId,
      users: updatedRoom.users,
      removedUserId: currentUserId,
      action: "leave",
    });
    io.to(currentUserId.toString()).emit("SERVER_LEAVE_ROOM_PERSON", {
      roomChatId,
    });
    io.in(currentUserId.toString()).socketsLeave(roomChatId);

    return res.status(200).json({
      success: true,
      message: "Rời nhóm thành công",
      error: false,
    });
  } catch (error) {
    if (sendRoomAuthorizationError(res, error)) return;
    return sendInternalServerError(res, error, "Leave room failed");
  }
};

module.exports.removeRoom = async (req, res) => {
  try {
    const roomChatId = req.params.roomChatId;
    const userId = res.locals.userId;
    const deletion = await deleteRoom(roomChatId, userId);

    const io = getIO();
    try {
      deletion.memberIds.forEach((memberId) => {
        io.to(memberId).emit("SERVER_RETURN_ROOM", { roomChatId });
      });
      io.in(roomChatId).socketsLeave(roomChatId);
    } catch (notificationError) {
      console.error("Room deletion notification failed", {
        roomChatId,
        error: notificationError,
      });
    }

    if (deletion.hasCleanupJob) {
      void triggerMediaCleanupWorker();
    }

    return res
      .status(200)
      .json({ success: true, message: "Phòng chat này đã được xóa!" });
  } catch (error) {
    if (sendRoomAuthorizationError(res, error)) return;
    return sendInternalServerError(res, error, "Delete room failed");
  }
};
