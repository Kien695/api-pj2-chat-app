const mongoose = require("mongoose");
const RoomChat = require("../model/room-chat.model");
const {
  requireRoomMember,
  sendRoomAuthorizationError,
} = require("../service/roomAuthorization.service");
const { cleanupAssets } = require("../service/cloudinaryAsset.service");
const MediaCleanupJob = require("../model/media-cleanup-job.model");
const { sendInternalServerError } = require("../utils/httpErrorResponse");
const {
  MessagePaginationError,
  getMessagePage,
} = require("../service/messagePagination.service");
//get chat
module.exports.index = async (req, res) => {
  try {
    const roomChatId = req.params.roomChatId;

    const userId = res.locals.userId;

    // validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(roomChatId)) {
      return res.status(400).json({
        success: false,
        message: "roomChatId không hợp lệ",
      });
    }

    const objectRoomChatId = new mongoose.Types.ObjectId(roomChatId);
    const objectUserId = new mongoose.Types.ObjectId(userId);

    // 1️ Lấy danh sách tin nhắn
    const page = await getMessagePage({
      roomId: roomChatId,
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    const chats = page.messages;
    const pagination = page.pagination;

    // 2️ Lấy room chat
    const room = await RoomChat.findById(objectRoomChatId)
      .select("title typeRoom avatar users inviteToken")
      .populate({
        path: "users.user_id",
        select: "name email avatar date_of_birth gender mobile lastActive ",
      });
   
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy phòng chat",
      });
    }
    //lấy thông tin phòng
    const roomInfo = {
      _id: room._id,
      title: room.title,
      typeRoom: room.typeRoom,
      avatar: room.avatar,

      inviteToken: room.inviteToken || "",
    };

    // 3️ Lọc user KHÔNG phải là mình
    let otherUsers = [];
    let commonGroupCount = 0;
    if (room.typeRoom === "group") {
      // Group chat: lấy tất cả user (kể cả mình)
      const admins = room.users.filter((u) => u.role === "admin");
      const members = room.users.filter((u) => u.role !== "admin");

      room.users = [...admins, ...members];

      otherUsers = room.users;
    } else {
      // Friend / private chat: chỉ lấy 1 user còn lại
      const otherUser = room.users.find(
        (u) =>
          u.user_id && u.user_id._id.toString() !== objectUserId.toString(),
      );

      otherUsers = otherUser ? [otherUser] : [];

      if (otherUser) {
        const otherUserId = otherUser.user_id._id;

        commonGroupCount = await RoomChat.countDocuments({
          typeRoom: "group",
          "users.user_id": { $all: [objectUserId, otherUserId] },
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: chats,
      pagination,
      room: roomInfo,
      users: otherUsers,
      commonGroupCount: commonGroupCount,
    });
  } catch (error) {
    if (error instanceof MessagePaginationError) {
      return res.status(error.status).json({
        success: false,
        error: true,
        code: error.code,
        message: error.message,
      });
    }
    return sendInternalServerError(res, error, "Get chat failed");
  }
};

//upload file chat
module.exports.create = async (req, res) => {
  try {
    const roomChatId = req.params.roomChatId;

    let files = req.body.files;

    if (typeof files === "string") {
      files = JSON.parse(files);
    }
    await requireRoomMember(roomChatId, res.locals.userId);
    const cleanupJob = await MediaCleanupJob.create({
      ownerId: res.locals.userId,
      assets: req.uploadedCloudinaryAssets,
      nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    return res.status(200).json({
      success: true,
      data: files.map((file) => ({
        ...file,
        cleanup_job_id: cleanupJob._id.toString(),
      })),
    });
  } catch (error) {
    await cleanupAssets(req.uploadedCloudinaryAssets).catch((cleanupError) => {
      console.error("Rejected chat upload cleanup failed", cleanupError);
    });
    if (sendRoomAuthorizationError(res, error)) return;
    return sendInternalServerError(res, error, "Create chat upload failed");
  }
};

module.exports.createImages = async (req, res) => {
  try {
    const roomChatId = req.params.roomChatId;
    await requireRoomMember(roomChatId, res.locals.userId);
    const cleanupJob = await MediaCleanupJob.create({
      ownerId: res.locals.userId,
      assets: req.uploadedCloudinaryAssets,
      nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    return res.status(200).json({
      success: true,
      data: req.body.images.map((image) => ({
        ...image,
        cleanup_job_id: cleanupJob._id.toString(),
      })),
    });
  } catch (error) {
    await cleanupAssets(req.uploadedCloudinaryAssets).catch((cleanupError) => {
      console.error("Rejected chat image upload cleanup failed", cleanupError);
    });
    if (sendRoomAuthorizationError(res, error)) return;
    return sendInternalServerError(res, error, "Create chat image upload failed");
  }
};
