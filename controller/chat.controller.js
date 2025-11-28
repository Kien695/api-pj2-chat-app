const Chat = require("../model/chat.model");
module.exports.index = async (req, res) => {
  const roomChatId = req.params.roomChatId;
  //lấy data ra giao diện
  const chats = await Chat.find({
    room_chat_id: roomChatId,
    deleted: false,
  }).populate({
    path: "user_id",
    select: "avatar name",
  });

  if (chats) {
    return res.status(200).json({
      success: true,
      data: chats,
    });
  }
};
