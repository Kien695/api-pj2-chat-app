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
    date_of_birth: {
      type: Date,
      default: "",
    },
    mobile: {
      type: String,
      default: "",
      unique: true,
    },
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
  },
  {
    timestamps: true,
  }
);
const User = mongoose.model("User", userSchema, "users");
module.exports = User;
