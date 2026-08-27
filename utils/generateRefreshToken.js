const { issueRefreshToken } = require("../service/refreshTokenRotation.service");
module.exports.generateRefreshToken = async (userId) => {
  return issueRefreshToken(userId);
};
