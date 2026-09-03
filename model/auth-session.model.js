const mongoose = require("mongoose");

const authSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    refreshTokenHash: { type: String, required: true },
    deviceId: { type: String, default: null },
    deviceInfo: { type: String, default: "Unknown device" },
    loginMethod: {
      type: String,
      enum: ["password", "google", "qr", "passkey", "legacy"],
      default: "legacy",
    },
    ipHash: { type: String, default: null },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null },
  },
  { timestamps: true },
);

authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: -1 });

module.exports = mongoose.model("AuthSession", authSessionSchema, "auth_sessions");
