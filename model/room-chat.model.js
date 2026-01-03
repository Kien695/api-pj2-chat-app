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
    //  TIN CUỐI (sidebar dùng)
    lastMessage: {
      content: String,
      images: Array,
      sender: {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
      createdAt: Date,
    },

    //  UNREAD THEO USER
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },

    deletedAt: Date,
  },
  {
    timestamps: true,
  }
);
const RoomChat = mongoose.model("RoomChat", roomChatSchema, "rooms-chat");
module.exports = RoomChat;
