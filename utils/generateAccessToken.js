const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
module.exports.generateAccessToken = (userId) => {
  const token = jwt.sign({
    id: userId.toString(),
    tokenType: "access",
    jti: randomUUID(),
  }, process.env.JWT_ACCESS_TOKEN, {
    algorithm: "HS256",
    expiresIn: "10m",
  });
  return token;
};
