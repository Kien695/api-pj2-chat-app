const webPush = require("web-push");
const PushSubscription = require("../model/push-subscription.model");
const { decryptSubscription, getEncryptionKey } = require("./pushSubscription.service");

const PUSH_CONCURRENCY = 20;

const configureWebPush = (
  environment = process.env,
  provider = webPush,
) => {
  const subject = environment.PUSH_VAPID_SUBJECT;
  const publicKey = environment.PUSH_VAPID_PUBLIC_KEY;
  const privateKey = environment.PUSH_VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error("PUSH_VAPID_SUBJECT, PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY are required");
  }
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    throw new Error("PUSH_VAPID_SUBJECT must use mailto: or https://");
  }
  provider.setVapidDetails(subject, publicKey, privateKey);
  return provider;
};

const createMessagePushPayload = ({ roomId, messageId, senderName, type }) =>
  JSON.stringify({
    title: senderName || "Tin nhắn mới",
    body:
      type === "image"
        ? "Đã gửi một hình ảnh"
        : type === "file"
          ? "Đã gửi một tệp"
          : "Đã gửi một tin nhắn",
    tag: `room:${roomId}`,
    url: `/chat/${roomId}`,
    roomId: String(roomId),
    messageId: String(messageId),
    type: "message",
  });

const createIncomingCallPushPayload = ({ callId, callerName, type }) =>
  JSON.stringify({
    title: callerName || "Cuộc gọi đến",
    body: type === "audio" ? "Cuộc gọi thoại đến" : "Cuộc gọi video đến",
    tag: `call:${callId}`,
    url: "/chat",
    callId: String(callId),
    callType: type,
    type: "incoming-call",
  });

const deliverPush = async ({
  recipientIds,
  payload,
  ttl,
  model,
  provider,
  encryptionKey,
  logger,
}) => {
  if (recipientIds.length === 0) {
    return { sent: 0, failed: 0, retryableFailed: 0, disabled: 0 };
  }
  const records = await model
    .find({ userId: { $in: recipientIds }, disabledAt: null })
    .lean();
  const result = { sent: 0, failed: 0, retryableFailed: 0, disabled: 0 };
  const invalidSubscriptionIds = [];

  for (let offset = 0; offset < records.length; offset += PUSH_CONCURRENCY) {
    const batch = records.slice(offset, offset + PUSH_CONCURRENCY);
    const outcomes = await Promise.allSettled(
      batch.map((record) =>
        Promise.resolve().then(() =>
          provider.sendNotification(
            decryptSubscription(record, encryptionKey),
            payload,
            { TTL: ttl, urgency: "high" },
          ),
        ),
      ),
    );
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") result.sent += 1;
      else {
        result.failed += 1;
        if ([404, 410].includes(outcome.reason?.statusCode)) {
          invalidSubscriptionIds.push(batch[index]._id);
        } else result.retryableFailed += 1;
        logger.error("Push notification delivery failed", {
          subscriptionId: batch[index]._id?.toString(),
          statusCode: outcome.reason?.statusCode,
        });
      }
    });
  }
  if (invalidSubscriptionIds.length > 0) {
    await model.updateMany(
      { _id: { $in: invalidSubscriptionIds } },
      { $set: { disabledAt: new Date() } },
    );
    result.disabled = invalidSubscriptionIds.length;
  }
  return result;
};

const notifyMessageRecipients = async (
  { room, message, sender },
  {
    model = PushSubscription,
    provider = configureWebPush(),
    encryptionKey = getEncryptionKey(),
    logger = console,
  } = {},
) => {
  const senderId = sender._id.toString();
  const recipientIds = room.users
    .map((member) => member.user_id.toString())
    .filter((memberId) => memberId !== senderId);
  const payload = createMessagePushPayload({
    roomId: room._id,
    messageId: message._id,
    senderName: sender.name,
    type: message.type,
  });
  return deliverPush({
    recipientIds,
    payload,
    ttl: 60,
    model,
    provider,
    encryptionKey,
    logger,
  });
};

const notifyIncomingCall = async (
  { calleeId, callId, caller, type },
  {
    model = PushSubscription,
    provider = configureWebPush(),
    encryptionKey = getEncryptionKey(),
    logger = console,
  } = {},
) =>
  deliverPush({
    recipientIds: [calleeId.toString()],
    payload: createIncomingCallPushPayload({
      callId,
      callerName: caller.name,
      type,
    }),
    ttl: 30,
    model,
    provider,
    encryptionKey,
    logger,
  });

module.exports = {
  PUSH_CONCURRENCY,
  configureWebPush,
  createIncomingCallPushPayload,
  createMessagePushPayload,
  notifyIncomingCall,
  notifyMessageRecipients,
};
