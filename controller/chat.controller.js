const mongoose = require("mongoose");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
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
    const chats = await Chat.find({
      room_chat_id: objectRoomChatId,
    })
      .populate({
        path: "user_id",
        select: "name avatar ",
      })
      .populate({
        path: "content_user",
        select: "name avatar ",
      });
    // 2️ Lấy room chat
    const room = await RoomChat.findById(objectRoomChatId)
      .select("title typeRoom avatar users")
      .populate({
        path: "users.user_id",
        select: "name avatar date_of_birth gender mobile lastActive ",
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
      room: roomInfo,
      users: otherUsers,
      commonGroupCount: commonGroupCount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
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
    const chat = new Chat({
      user_id: res.locals.userId,
      room_chat_id: roomChatId,
      files: files,
    });

    await chat.save();

    return res.status(200).json({
      success: true,
      data: chat.files,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
