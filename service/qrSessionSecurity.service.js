const crypto = require("crypto");
const redis = require("../config/redis");

const QR_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QR_SUBSCRIBER_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

class QrSessionSecurityError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "QrSessionSecurityError";
    this.status = status;
    this.code = code;
  }
}

const qrKey = (sessionId) => `qr:${sessionId}`;
const qrRoomName = (sessionId) => `qr-session:${sessionId}`;
const hashSubscriberToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createSubscriberCredential = () => {
  const subscriberToken = crypto.randomBytes(32).toString("hex");
  return {
    subscriberToken,
    subscriberTokenHash: hashSubscriberToken(subscriberToken),
  };
};

const validateQrSessionId = (sessionId) => {
  if (typeof sessionId !== "string" || !QR_SESSION_ID_PATTERN.test(sessionId)) {
    throw new QrSessionSecurityError(400, "INVALID_QR_SESSION_ID", "Mã phiên QR không hợp lệ");
  }
  return sessionId;
};

const parseQrSessionPayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new QrSessionSecurityError(400, "INVALID_QR_SUBSCRIPTION", "Thông tin đăng ký QR không hợp lệ");
  }
  const { sessionId, subscriberToken } = payload;
  if (
    typeof sessionId !== "string" ||
    !QR_SESSION_ID_PATTERN.test(sessionId) ||
    typeof subscriberToken !== "string" ||
    !QR_SUBSCRIBER_TOKEN_PATTERN.test(subscriberToken)
  ) {
    throw new QrSessionSecurityError(400, "INVALID_QR_SUBSCRIPTION", "Thông tin đăng ký QR không hợp lệ");
  }
  return { sessionId, subscriberToken };
};

const authorizeQrSubscription = async (payload, redisClient = redis) => {
  const { sessionId, subscriberToken } = parseQrSessionPayload(payload);
  const rawSession = await redisClient.get(qrKey(sessionId));
  if (!rawSession) {
    throw new QrSessionSecurityError(404, "QR_SESSION_EXPIRED", "Phiên đăng nhập QR đã hết hạn");
  }

  let session;
  try {
    session = JSON.parse(rawSession);
  } catch {
    throw new QrSessionSecurityError(400, "INVALID_QR_SESSION", "Phiên đăng nhập QR không hợp lệ");
  }

  const expectedHash = session.subscriberTokenHash;
  const actualHash = hashSubscriberToken(subscriberToken);
  if (
    typeof expectedHash !== "string" ||
    expectedHash.length !== actualHash.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(actualHash))
  ) {
    throw new QrSessionSecurityError(403, "QR_SUBSCRIPTION_DENIED", "Không có quyền theo dõi phiên QR này");
  }

  return { sessionId, roomName: qrRoomName(sessionId) };
};

const requireQrActor = (qrSession, userId) => {
  if (!qrSession?.userId || qrSession.userId.toString() !== userId.toString()) {
    throw new QrSessionSecurityError(403, "QR_ACTOR_MISMATCH", "Bạn không có quyền thao tác phiên QR này");
  }
};

module.exports = {
  QrSessionSecurityError,
  authorizeQrSubscription,
  createSubscriberCredential,
  qrKey,
  qrRoomName,
  requireQrActor,
  validateQrSessionId,
};
