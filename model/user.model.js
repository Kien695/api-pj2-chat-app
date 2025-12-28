const { verify } = require("jsonwebtoken");
const mongoose = require("mongoose");
const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: {
      type: String,
      unique: true,
    },
    password: { type: String },
    googleId: {
      type: String,
    },
    avatar: {
      type: String,
      default: "",
    },
    avatar_public_id: {
      type: String,
      default: "",
    },
    background: {
      type: String,
      default: "",
    },
    background_public_id: {
      type: String,
      default: "",
    },
    date_of_birth: {
      type: Date,
      default: "",
    },
    mobile: {
      type: String,
      default: "",
      unique: true,
    },
    gender: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["online", "offline"],
      default: "offline",
    },
    lastActive: { type: Date, default: null },
    verify_email: {
      type: Boolean,
      default: false,
    },
    access_token: {
      type: String,
      default: "",
    },
    refresh_token: {
      type: String,
      default: "",
    },
    otp: {
      type: String,
    },
    otp_expiry: { type: Date },
    requestFriends: [
      {
        id: String,
        message: String,
      },
    ],
    acceptFriends: [
      {
        id: String,
        message: String,
      },
    ],
    FriendList: [
      {
        user_id: String,
        room_chat_id: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);
const User = mongoose.model("User", userSchema, "users");
module.exports = User;
