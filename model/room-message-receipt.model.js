const mongoose = require("mongoose");

const roomMessageReceiptSchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.ObjectId, ref: "RoomChat", required: true },
    userId: { type: mongoose.Schema.ObjectId, ref: "User", required: true },
    lastDeliveredMessageId: { type: mongoose.Schema.ObjectId, ref: "Chat" },
    lastDeliveredMessageCreatedAt: Date,
    deliveredAt: Date,
    lastReadMessageId: { type: mongoose.Schema.ObjectId, ref: "Chat" },
    lastReadMessageCreatedAt: Date,
    readAt: Date,
  },
  { timestamps: true },
);

roomMessageReceiptSchema.index(
  { roomId: 1, userId: 1 },
  { name: "roomId_1_userId_1", unique: true },
);

module.exports = mongoose.model(
  "RoomMessageReceipt",
  roomMessageReceiptSchema,
  "room-message-receipts",
);
