const mongoose = require("mongoose");

const passkeySchema = new mongoose.Schema(
  {
    credentialID: {
      type: String,
      required: true,
      unique: true,
    },
    publicKey: {
      type: Buffer,
      required: true,
    },
    counter: {
      type: Number,
      required: true,
    },
    transports: {
      type: [String],
      default: [],
    },
    deviceType: {
      type: String,
      required: true,
    },
    backedUp: {
      type: Boolean,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);
passkeySchema.index({ user: 1 });
const Passkey = mongoose.model("Passkey", passkeySchema, "passkeys");
module.exports = Passkey;
