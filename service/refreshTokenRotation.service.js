const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../model/user.model");

const REFRESH_TOKEN_TTL = "7d";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class RefreshTokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RefreshTokenError";
    this.status = 401;
    this.code = code;
  }
}

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createRefreshToken = (
  userId,
  sign = jwt.sign,
  secret = process.env.JWT_REFRESH_TOKEN,
) =>
  sign(
    { id: userId.toString(), tokenType: "refresh", jti: crypto.randomUUID() },
    secret,
    { algorithm: "HS256", expiresIn: REFRESH_TOKEN_TTL },
  );

const issueRefreshToken = async (userId, userModel = User) => {
  const token = createRefreshToken(userId);
  const result = await userModel.updateOne(
    { _id: userId },
    { $set: { refresh_token: hashRefreshToken(token) } },
  );
  if (result.matchedCount !== 1) {
    throw new RefreshTokenError("REFRESH_SESSION_NOT_CREATED", "Không thể tạo phiên đăng nhập");
  }
  return token;
};

const verifyRefreshToken = (
  token,
  verify = jwt.verify,
  secret = process.env.JWT_REFRESH_TOKEN,
) => {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    throw new RefreshTokenError("REFRESH_TOKEN_REQUIRED", "Refresh token không hợp lệ");
  }
  try {
    const decoded = verify(token, secret, { algorithms: ["HS256"] });
    if (
      !decoded ||
      typeof decoded !== "object" ||
      decoded.tokenType !== "refresh" ||
      !mongoose.isValidObjectId(decoded.id) ||
      typeof decoded.jti !== "string" ||
      !UUID_PATTERN.test(decoded.jti)
    ) {
      throw new RefreshTokenError("INVALID_REFRESH_TOKEN", "Refresh token không hợp lệ");
    }
    return decoded;
  } catch (error) {
    if (error instanceof RefreshTokenError) throw error;
    if (error?.name === "TokenExpiredError") {
      throw new RefreshTokenError("REFRESH_TOKEN_EXPIRED", "Phiên đăng nhập đã hết hạn");
    }
    throw new RefreshTokenError("INVALID_REFRESH_TOKEN", "Refresh token không hợp lệ");
  }
};

const rotateRefreshToken = async (token, userModel = User) => {
  const decoded = verifyRefreshToken(token);
  const replacement = createRefreshToken(decoded.id);
  const user = await userModel.findOneAndUpdate(
    { _id: decoded.id, refresh_token: hashRefreshToken(token) },
    { $set: { refresh_token: hashRefreshToken(replacement) } },
    { new: true, projection: { _id: 1 } },
  );
  if (!user) {
    throw new RefreshTokenError(
      "REFRESH_TOKEN_REPLAYED_OR_REVOKED",
      "Phiên đăng nhập đã bị thu hồi hoặc token đã được sử dụng",
    );
  }
  return { userId: decoded.id, refreshToken: replacement };
};

module.exports = {
  RefreshTokenError,
  createRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  rotateRefreshToken,
  verifyRefreshToken,
};
