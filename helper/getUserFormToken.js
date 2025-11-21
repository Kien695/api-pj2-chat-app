const jwt = require("jsonwebtoken");
const User = require("../model/user.model");
module.exports.getUserDetail = async (token) => {
  if (!token) {
    return {
      message: "Chưa đăng nhập",
      error: true,
    };
  }
  const decode = jwt.verify(token, process.env.JWT_ACCESS_TOKEN);
  if (!decode) {
    return {
      error: true,
      success: false,
      message: "Token không hợp lệ",
    };
  } else {
    const user = await User.findById(decode.id).select(
      "-password -refreshToken"
    );
    return user;
  }
};
