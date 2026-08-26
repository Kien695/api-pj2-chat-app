const {
  requireGroupAdmin,
  requireRoomMember,
  sendRoomAuthorizationError,
} = require("../service/roomAuthorization.service");

const getRoomId = (req) => req.params.roomChatId || req.params.id;

const authorize = (policy) => async (req, res, next) => {
  try {
    const roomChatId = getRoomId(req);
    const userId = res.locals.userId;

    const access = await policy(roomChatId, userId);
    res.locals.roomChat = access.room;
    res.locals.roomMember = access.member;
    next();
  } catch (error) {
    if (sendRoomAuthorizationError(res, error)) return;

    return res.status(500).json({
      error: true,
      success: false,
      message: "Server error",
    });
  }
};

module.exports.isAccess = authorize(requireRoomMember);
module.exports.isGroupAdmin = authorize(requireGroupAdmin);
