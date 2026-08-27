const mongoose = require("mongoose");

const mediaCleanupJobSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["assets", "room-deletion"],
      default: "assets",
      index: true,
    },
    ownerId: { type: mongoose.Schema.ObjectId, ref: "User" },
    roomId: { type: mongoose.Schema.ObjectId, ref: "RoomChat", index: true },
    assets: [
      new mongoose.Schema(
        {
          public_id: { type: String, required: true },
          url: String,
          resource_type: {
            type: String,
            enum: ["image", "raw", "video"],
            default: "image",
          },
        },
        { _id: false },
      ),
    ],
    status: {
      type: String,
      enum: ["pending", "processing"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lastError: String,
  },
  { timestamps: true },
);

const MediaCleanupJob = mongoose.model(
  "MediaCleanupJob",
  mediaCleanupJobSchema,
  "media-cleanup-jobs",
);
module.exports = MediaCleanupJob;
