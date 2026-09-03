const crypto = require("crypto");
const mongoose = require("mongoose");
const AuthSession = require("../model/auth-session.model");

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_METHODS = new Set(["password", "google", "qr", "passkey", "legacy"]);

class AuthSessionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AuthSessionError";
    this.code = code;
    this.status = status;
  }
}

const hashSessionSecret = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    throw new AuthSessionError("INVALID_SESSION_SECRET", "Session secret is invalid");
  }
  return crypto.createHash("sha256").update(value).digest("hex");
};

const normalizeOptionalUuid = (value) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AuthSessionError("INVALID_DEVICE_ID", "Device id is invalid");
  }
  return value.toLowerCase();
};

const normalizeSessionMetadata = ({ deviceId, deviceInfo, loginMethod, ipAddress } = {}) => ({
  deviceId: normalizeOptionalUuid(deviceId),
  deviceInfo:
    typeof deviceInfo === "string" && deviceInfo.trim()
      ? deviceInfo.trim().slice(0, 256)
      : "Unknown device",
  loginMethod: LOGIN_METHODS.has(loginMethod) ? loginMethod : "legacy",
  ipHash:
    typeof ipAddress === "string" && ipAddress.trim()
      ? hashSessionSecret(ipAddress.trim())
      : null,
});

const validateIdentity = (userId, sessionId) => {
  if (!mongoose.isValidObjectId(userId) || !UUID_PATTERN.test(sessionId || "")) {
    throw new AuthSessionError("INVALID_SESSION_IDENTITY", "Session identity is invalid");
  }
};

const createAuthSession = async (
  { userId, sessionId = crypto.randomUUID(), refreshToken, expiresAt, metadata },
  model = AuthSession,
  now = new Date(),
) => {
  validateIdentity(userId, sessionId);
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry <= now) {
    throw new AuthSessionError("INVALID_SESSION_EXPIRY", "Session expiry is invalid");
  }
  return model.create({
    sessionId: sessionId.toLowerCase(),
    userId,
    refreshTokenHash: hashSessionSecret(refreshToken),
    ...normalizeSessionMetadata(metadata),
    lastUsedAt: now,
    expiresAt: expiry,
  });
};

const findActiveSession = async (
  { userId, sessionId },
  model = AuthSession,
  now = new Date(),
) => {
  validateIdentity(userId, sessionId);
  return model.findOne({
    userId,
    sessionId: sessionId.toLowerCase(),
    revokedAt: null,
    expiresAt: { $gt: now },
  });
};

const touchAuthSession = async (
  { userId, sessionId },
  model = AuthSession,
  now = new Date(),
) => {
  validateIdentity(userId, sessionId);
  return model.updateOne(
    { userId, sessionId: sessionId.toLowerCase(), revokedAt: null, expiresAt: { $gt: now } },
    { $set: { lastUsedAt: now } },
  );
};

const revokeAuthSession = async (
  { userId, sessionId, reason = "logout" },
  model = AuthSession,
  now = new Date(),
) => {
  validateIdentity(userId, sessionId);
  return model.updateOne(
    { userId, sessionId: sessionId.toLowerCase(), revokedAt: null },
    { $set: { revokedAt: now, revokeReason: String(reason).slice(0, 64) } },
  );
};

const revokeAllAuthSessions = async (
  { userId, reason = "security" },
  model = AuthSession,
  now = new Date(),
) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw new AuthSessionError("INVALID_SESSION_IDENTITY", "Session identity is invalid");
  }
  return model.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: now, revokeReason: String(reason).slice(0, 64) } },
  );
};

const listActiveAuthSessions = async (
  { userId, currentSessionId },
  model = AuthSession,
  now = new Date(),
) => {
  if (!mongoose.isValidObjectId(userId)) {
    throw new AuthSessionError("INVALID_SESSION_IDENTITY", "Session identity is invalid");
  }
  const sessions = await model
    .find({ userId, revokedAt: null, expiresAt: { $gt: now } })
    .select("sessionId deviceId deviceInfo loginMethod lastUsedAt expiresAt createdAt")
    .sort({ lastUsedAt: -1 })
    .lean();
  return sessions.map((session) => ({
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    deviceInfo: session.deviceInfo,
    loginMethod: session.loginMethod,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
    current:
      typeof currentSessionId === "string" &&
      session.sessionId.toLowerCase() === currentSessionId.toLowerCase(),
  }));
};

const revokeOtherAuthSession = async (
  { userId, currentSessionId, targetSessionId },
  model = AuthSession,
  now = new Date(),
) => {
  validateIdentity(userId, currentSessionId);
  validateIdentity(userId, targetSessionId);
  if (currentSessionId.toLowerCase() === targetSessionId.toLowerCase()) {
    throw new AuthSessionError(
      "CURRENT_SESSION_REQUIRES_LOGOUT",
      "Use logout to revoke the current session",
      409,
    );
  }
  const result = await model.updateOne(
    {
      userId,
      sessionId: targetSessionId.toLowerCase(),
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { revokedAt: now, revokeReason: "remote_logout" } },
  );
  if (result.matchedCount !== 1) {
    throw new AuthSessionError("SESSION_NOT_FOUND", "Session was not found", 404);
  }
  return true;
};

const revokeOtherAuthSessions = async (
  { userId, currentSessionId },
  model = AuthSession,
  now = new Date(),
) => {
  validateIdentity(userId, currentSessionId);
  const result = await model.updateMany(
    {
      userId,
      sessionId: { $ne: currentSessionId.toLowerCase() },
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { revokedAt: now, revokeReason: "remote_logout_all" } },
  );
  return result.modifiedCount || 0;
};

module.exports = {
  AuthSessionError,
  SESSION_TTL_MS,
  createAuthSession,
  findActiveSession,
  hashSessionSecret,
  listActiveAuthSessions,
  normalizeSessionMetadata,
  revokeAllAuthSessions,
  revokeAuthSession,
  revokeOtherAuthSession,
  revokeOtherAuthSessions,
  touchAuthSession,
};
