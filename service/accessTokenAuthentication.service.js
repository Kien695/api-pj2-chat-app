const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const ACCESS_TOKEN_JTI_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class AccessTokenAuthenticationError extends Error {
  constructor(code, message, expired = false) {
    super(message);
    this.name = "AccessTokenAuthenticationError";
    this.code = code;
    this.expired = expired;
  }
}

const extractBearerToken = (authorizationHeader) => {
  if (authorizationHeader == null || authorizationHeader === "") return null;
  if (typeof authorizationHeader !== "string") {
    throw new AccessTokenAuthenticationError(
      "INVALID_AUTHORIZATION_HEADER",
      "Thông tin xác thực không hợp lệ",
    );
  }

  const match = authorizationHeader.match(/^Bearer ([^\s]+)$/);
  if (!match || match[1].length > 4096) {
    throw new AccessTokenAuthenticationError(
      "INVALID_AUTHORIZATION_HEADER",
      "Authorization header phải có định dạng Bearer token",
    );
  }
  return match[1];
};

const verifyAccessToken = (
  token,
  secret = process.env.JWT_ACCESS_TOKEN,
  verify = jwt.verify,
) => {
  if (!token) {
    throw new AccessTokenAuthenticationError(
      "ACCESS_TOKEN_REQUIRED",
      "Chưa đăng nhập",
    );
  }

  try {
    const decoded = verify(token, secret, { algorithms: ["HS256"] });
    if (
      !decoded ||
      typeof decoded !== "object" ||
      decoded.tokenType !== "access" ||
      !mongoose.isValidObjectId(decoded.id) ||
      typeof decoded.jti !== "string" ||
      !ACCESS_TOKEN_JTI_PATTERN.test(decoded.jti)
    ) {
      throw new AccessTokenAuthenticationError(
        "INVALID_ACCESS_TOKEN",
        "Token không hợp lệ",
      );
    }
    return decoded;
  } catch (error) {
    if (error instanceof AccessTokenAuthenticationError) throw error;
    if (error?.name === "TokenExpiredError") {
      throw new AccessTokenAuthenticationError(
        "ACCESS_TOKEN_EXPIRED",
        "Token đã hết hạn",
        true,
      );
    }
    throw new AccessTokenAuthenticationError(
      "INVALID_ACCESS_TOKEN",
      "Token không hợp lệ",
    );
  }
};

module.exports = {
  AccessTokenAuthenticationError,
  extractBearerToken,
  verifyAccessToken,
};
