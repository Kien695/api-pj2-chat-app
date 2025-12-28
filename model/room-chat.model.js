const mongoose = require("mongoose");
const roomChatSchema = new mongoose.Schema(
  {
    title: String,
    avatar: {
      type: String,
      default: "",
    },
    avatar_public_id: {
      type: String,
      default: "",
    },
    typeRoom: String,
    status: String,
    users: [
      {
        user_id: {
          type: mongoose.Schema.ObjectId,
          ref: "User",
        },
        role: String,
      },
    ],

    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);
const RoomChat = mongoose.model("RoomChat", roomChatSchema, "rooms-chat");
module.exports = RoomChat;
