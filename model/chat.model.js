const mongoose = require("mongoose");
const chatSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    room_chat_id: { type: mongoose.Schema.ObjectId, ref: "RoomChat" },
    content: String,
    // images: [{ url: { type: String }, public_id: { type: String } }],
    images: [
      new mongoose.Schema(
        {
          url: String,
          public_id: String,
        },
        { _id: false },
      ),
    ],
    video: String,
    video_public_id: String,
    files: [
      new mongoose.Schema(
        {
          url: { type: String },
          public_id: { type: String },
          name: { type: String },
          size: { type: Number },
          type: { type: String },
        },
        { _id: false },
      ),
    ],

    type: {
      type: String,
      enum: ["system"],
    },

    action: {
      type: String,
      enum: ["rename_group", "add_member", "leave_group", "remove_member"],
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
  },
);
// if (mongoose.models.Chat) {
//   delete mongoose.models.Chat;
// }
const Chat = mongoose.model("Chat", chatSchema, "chats");
module.exports = Chat;
