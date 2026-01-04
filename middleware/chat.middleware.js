const RoomChat = require("../model/room-chat.model");

module.exports.isAccess = async (req, res, next) => {
  try {
    const roomChatId = req.params.roomChatId;
    const userId = res.locals.userId;

    const exitRoomChat = await RoomChat.findOne({
      _id: roomChatId,
      "users.user_id": userId,
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
