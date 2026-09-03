const crypto = require("crypto");
const User = require("../model/user.model");
const AuthSession = require("../model/auth-session.model");
const { generateAccessToken } = require("../utils/generateAccessToken");
const {
  createRefreshToken,
  hashRefreshToken,
} = require("./refreshTokenRotation.service");
const {
  SESSION_TTL_MS,
  createAuthSession,
  revokeAuthSession,
} = require("./authSession.service");

const sessionMetadataFromRequest = (req, loginMethod, overrides = {}) => ({
  deviceId: req?.body?.deviceId,
  deviceInfo:
    overrides.deviceInfo || req?.body?.deviceInfo || req?.headers?.["user-agent"],
  loginMethod,
  ipAddress: req?.ip || req?.socket?.remoteAddress,
});

const issueAuthenticationSession = async (
  { userId, metadata = {} },
  dependencies = {},
) => {
  const userModel = dependencies.userModel || User;
  const sessionModel = dependencies.sessionModel || AuthSession;
  const now = dependencies.now || new Date();
  const sessionId = (dependencies.randomUUID || crypto.randomUUID)();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const refreshToken = createRefreshToken(
    userId,
    dependencies.sign,
    dependencies.refreshSecret,
    sessionId,
  );

  await createAuthSession(
    { userId, sessionId, refreshToken, expiresAt, metadata },
    sessionModel,
    now,
  );

  try {
    const result = await userModel.updateOne(
      { _id: userId },
      { $set: { refresh_token: hashRefreshToken(refreshToken) } },
    );
    if (result.matchedCount !== 1) throw new Error("User not found");
  } catch (error) {
    await revokeAuthSession(
      { userId, sessionId, reason: "issuance_failed" },
      sessionModel,
      now,
    ).catch(() => {});
    throw error;
  }

  return {
    accessToken: generateAccessToken(userId, sessionId),
    refreshToken,
    sessionId,
  };
};

module.exports = {
  issueAuthenticationSession,
  sessionMetadataFromRequest,
};
