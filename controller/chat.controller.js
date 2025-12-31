const mongoose = require("mongoose");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
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
      deleted: false,
    }).populate({
      path: "user_id",
      select: "name avatar ",
    });

    // 2️ Lấy room chat
    const room = await RoomChat.findById(objectRoomChatId)
      .select("title typeRoom avatar users")
      .populate({
        path: "users.user_id",
        select: "name avatar lastActive ",
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

    if (room.typeRoom === "group") {
      // Group chat: lấy tất cả user (kể cả mình)
      otherUsers = room.users;
    } else {
      // Friend / private chat: chỉ lấy 1 user còn lại
      const otherUser = room.users.find(
        (u) => u.user_id && u.user_id._id.toString() !== objectUserId.toString()
      );

      otherUsers = otherUser ? [otherUser] : [];
    }

    return res.status(200).json({
      success: true,
      data: chats,
      room: roomInfo,
      users: otherUsers,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};
