const crypto = require("crypto");
const mongoose = require("mongoose");
const PushSubscription = require("../model/push-subscription.model");

const DEVICE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

class PushSubscriptionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PushSubscriptionError";
    this.code = code;
    this.status = status;
  }
}

const invalidSubscription = () => {
  throw new PushSubscriptionError(
    "INVALID_PUSH_SUBSCRIPTION",
    "Thông tin đăng ký thông báo không hợp lệ",
  );
};

const getEncryptionKey = (encodedKey = process.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY) => {
  if (typeof encodedKey !== "string" || !encodedKey) {
    throw new Error("PUSH_SUBSCRIPTION_ENCRYPTION_KEY is required");
  }
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("PUSH_SUBSCRIPTION_ENCRYPTION_KEY must be a canonical Base64 32-byte key");
  }
  return key;
};

const normalizePushSubscription = (body) => {
  const endpoint = body?.subscription?.endpoint;
  const p256dh = body?.subscription?.keys?.p256dh;
  const auth = body?.subscription?.keys?.auth;
  const deviceId = body?.deviceId;
  let endpointUrl;

  try {
    endpointUrl = new URL(endpoint);
  } catch {
    invalidSubscription();
  }
  if (
    endpointUrl.protocol !== "https:" ||
    endpoint.length > 2048 ||
    typeof p256dh !== "string" ||
    p256dh.length < 40 ||
    p256dh.length > 512 ||
    !BASE64URL_PATTERN.test(p256dh) ||
    typeof auth !== "string" ||
    auth.length < 16 ||
    auth.length > 256 ||
    !BASE64URL_PATTERN.test(auth) ||
    typeof deviceId !== "string" ||
    !DEVICE_ID_PATTERN.test(deviceId)
  ) {
    invalidSubscription();
  }

  const expirationValue = body.subscription.expirationTime;
  const expirationTime = expirationValue == null ? null : new Date(expirationValue);
  if (expirationTime && Number.isNaN(expirationTime.getTime())) invalidSubscription();

  return {
    deviceId: deviceId.toLowerCase(),
    expirationTime,
    subscription: { endpoint: endpointUrl.toString(), keys: { p256dh, auth } },
  };
};

const encryptSubscription = (subscription, key) => {
  const encryptionIv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, encryptionIv);
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(subscription), "utf8"),
    cipher.final(),
  ]);
  return {
    encryptedPayload: encryptedPayload.toString("base64"),
    encryptionIv: encryptionIv.toString("base64"),
    encryptionTag: cipher.getAuthTag().toString("base64"),
  };
};

const decryptSubscription = (record, key = getEncryptionKey()) => {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.encryptionIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(record.encryptionTag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(record.encryptedPayload, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
};

const registerPushSubscription = async (
  { userId, body, deviceInfo, sessionId },
  model = PushSubscription,
  key = getEncryptionKey(),
) => {
  if (!mongoose.isValidObjectId(userId)) invalidSubscription();
  const normalized = normalizePushSubscription(body);
  const endpointHash = crypto
    .createHmac("sha256", key)
    .update(normalized.subscription.endpoint)
    .digest("hex");
  const encrypted = encryptSubscription(normalized.subscription, key);
  const safeDeviceInfo =
    typeof deviceInfo === "string" && deviceInfo.trim()
      ? deviceInfo.trim().slice(0, 256)
      : "Web browser";

  return model.findOneAndUpdate(
    { endpointHash },
    {
      $set: {
        userId,
        endpointHash,
        ...encrypted,
        deviceId: normalized.deviceId,
        sessionId: typeof sessionId === "string" ? sessionId.toLowerCase() : null,
        deviceInfo: safeDeviceInfo,
        expirationTime: normalized.expirationTime,
        disabledAt: null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
};

const removePushSubscription = async (
  { userId, subscriptionId },
  model = PushSubscription,
) => {
  if (
    !mongoose.isValidObjectId(userId) ||
    !mongoose.isValidObjectId(subscriptionId)
  ) {
    invalidSubscription();
  }
  const result = await model.deleteOne({ _id: subscriptionId, userId });
  return result.deletedCount === 1;
};

const removePushSubscriptionForLogout = async (
  { userId, subscriptionId },
  model = PushSubscription,
) => {
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(subscriptionId)) {
    return false;
  }
  const result = await model.deleteOne({ _id: subscriptionId, userId });
  return result.deletedCount === 1;
};

const removeAllPushSubscriptions = async (
  userId,
  model = PushSubscription,
) => {
  if (!mongoose.isValidObjectId(userId)) invalidSubscription();
  const result = await model.deleteMany({ userId });
  return result.deletedCount || 0;
};

const removePushSubscriptionsForSessions = async (
  { userId, sessionIds },
  model = PushSubscription,
) => {
  if (
    !mongoose.isValidObjectId(userId) ||
    !Array.isArray(sessionIds) ||
    sessionIds.some((sessionId) => typeof sessionId !== "string" || !DEVICE_ID_PATTERN.test(sessionId))
  ) {
    invalidSubscription();
  }
  if (sessionIds.length === 0) return 0;
  const result = await model.deleteMany({
    userId,
    sessionId: { $in: sessionIds.map((sessionId) => sessionId.toLowerCase()) },
  });
  return result.deletedCount || 0;
};

module.exports = {
  PushSubscriptionError,
  decryptSubscription,
  encryptSubscription,
  getEncryptionKey,
  normalizePushSubscription,
  registerPushSubscription,
  removeAllPushSubscriptions,
  removePushSubscription,
  removePushSubscriptionForLogout,
  removePushSubscriptionsForSessions,
};
