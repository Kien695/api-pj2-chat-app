const Chat = require("../model/chat.model");
module.exports.index = async (req, res) => {
  //lấy data ra giao diện
  const chats = await Chat.find({ deleted: false }).populate({
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
