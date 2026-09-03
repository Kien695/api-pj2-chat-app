const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
module.exports.generateAccessToken = (userId, sessionId) => {
  const payload = {
    id: userId.toString(),
    tokenType: "access",
    jti: randomUUID(),
  };
  if (sessionId) payload.sid = sessionId;
  const token = jwt.sign(payload, process.env.JWT_ACCESS_TOKEN, {
    algorithm: "HS256",
    expiresIn: "10m",
  });
  return token;
};
