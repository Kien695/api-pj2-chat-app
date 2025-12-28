const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
module.exports.index = async (req, res) => {
  try {
    const roomChatId = req.params.roomChatId;
    const userId = res.locals.userId;
    console.log(userId || "ok");
    //lấy data ra giao diện
    const chats = await Chat.find({
      room_chat_id: roomChatId,
      deleted: false,
    }).populate({
      path: "user_id",
      select: "name avatar",
    });
    const users = await RoomChat.findOne({
      _id: roomChatId,
      "users.user_id": { $ne: userId },
    }).populate({
      path: "users.user_id",
      select: "-password -refresh_token -googleId",
    });
    if (chats && users) {
      return res.status(200).json({
        success: true,
        data: chats,
        users: users,
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Lỗi server",
    });
  }
};
