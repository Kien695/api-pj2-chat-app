const RoomChat = require("../model/room-chat.model");

module.exports.isAccess = async (req, res, next) => {
  try {
    const userId = res.locals.userId;
    const roomChatId = req.params.roomChatId;
    const exitRoomChat = await RoomChat.findOne({
      "users.user_id": userId,
      _id: roomChatId,
      deleted: false,
    });
    if (exitRoomChat) {
      next();
    } else {
      return res.status(400).json({
        error: true,
        success: false,
        link: "/chat",
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: true,
      success: false,
      message: "Server error",
    });
  }
};
