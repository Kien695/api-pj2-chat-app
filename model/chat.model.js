const mongoose = require("mongoose");
const chatSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    room_chat_id: { type: mongoose.Schema.ObjectId, ref: "RoomChat" },
    content: String,
    images: [{ url: { type: String }, public_id: { type: String } }],
    video: String,
    video_public_id: String,
    file: String,
    file_public_id: String,
    type: {
      type: String,
      enum: ["system"],
    },

    action: {
      type: String,
      enum: ["rename_group", "add_member", "leave_group"],
    },
    content_user: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);
const Chat = mongoose.model("Chat", chatSchema, "chats");
module.exports = Chat;
