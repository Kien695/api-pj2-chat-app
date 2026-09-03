const mongoose = require("mongoose");

const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpointHash: { type: String, required: true, unique: true },
    encryptedPayload: { type: String, required: true },
    encryptionIv: { type: String, required: true },
    encryptionTag: { type: String, required: true },
    deviceId: { type: String, required: true },
    sessionId: { type: String, default: null, index: true },
    deviceInfo: { type: String, default: "Web browser" },
    expirationTime: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "PushSubscription",
  pushSubscriptionSchema,
  "push_subscriptions",
);
