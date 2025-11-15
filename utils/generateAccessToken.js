const jwt = require("jsonwebtoken");
module.exports.generateAccessToken = (userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_ACCESS_TOKEN, {
    expiresIn: "5h",
  });
  return token;
};
