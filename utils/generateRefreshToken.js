const jwt = require("jsonwebtoken");
const User = require("../model/user.model");
module.exports.generateRefreshToken = async (userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_REFRESH_TOKEN, {
    expiresIn: "7d",
  });
  await User.updateOne(
    { _id: userId },
    {
      refresh_token: token,
    }
  );
  return token;
};
