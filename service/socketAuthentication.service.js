const { getUserDetail } = require("../helper/getUserFormToken");

const MAX_SOCKET_TOKEN_LENGTH = 4096;

class SocketAuthenticationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SocketAuthenticationError";
    this.data = { code };
  }
}

const authenticateSocket = async (token, findUserByToken = getUserDetail) => {
  if (token == null || token === "") return null;
  if (typeof token !== "string" || token.length > MAX_SOCKET_TOKEN_LENGTH) {
    throw new SocketAuthenticationError(
      "INVALID_SOCKET_TOKEN",
      "Thông tin xác thực Socket không hợp lệ",
    );
  }

  try {
    const user = await findUserByToken(token);
    if (!user?._id || user.error) throw new Error("User not found");
    return user;
  } catch {
    throw new SocketAuthenticationError(
      "SOCKET_AUTHENTICATION_FAILED",
      "Phiên đăng nhập Socket không hợp lệ hoặc đã hết hạn",
    );
  }
};

const socketAuthenticationMiddleware = async (socket, next) => {
  try {
    socket.data.authenticatedUser = await authenticateSocket(
      socket.handshake?.auth?.token,
    );
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  SocketAuthenticationError,
  authenticateSocket,
  socketAuthenticationMiddleware,
};
