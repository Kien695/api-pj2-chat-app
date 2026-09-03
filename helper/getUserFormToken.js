const User = require("../model/user.model");
const {
  authenticateAccessToken,
  extractBearerToken,
} = require("../service/accessTokenAuthentication.service");
module.exports.getUserDetail = async (token) => {
  if (!token) {
    return {
      message: "Chưa đăng nhập",
      error: true,
    };
  }
  const decode = await authenticateAccessToken(extractBearerToken(`Bearer ${token}`));
  if (!decode) {
    return {
      error: true,
      success: false,
      message: "Token không hợp lệ",
    };
  } else {
    const user = await User.findById(decode.id).select(
      "_id name email avatar",
    );
    if (!user) return null;
    return {
      ...user.toObject(),
      sessionId: decode.sid || null,
    };
  }
};
