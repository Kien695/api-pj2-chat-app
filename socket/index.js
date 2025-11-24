const express = require("express");
const User = require("../model/user.model");
const Chat = require("../model/chat.model");
const { Server } = require("socket.io");
const http = require("http");
const { getUserDetail } = require("../helper/getUserFormToken");
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});
const app = express();

// socket connection
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FE_URL,
    credentials: true,
  },
});

// socket running at localhost:3000

//online user
const onlineUser = new Set();

io.on("connection", async (socket) => {
  const token = socket.handshake.auth.token;
  const user = await getUserDetail(token);
  //message
  socket.on("CLIENT_SEND_MASSAGE", async (content) => {
    const { message, images } = content;

    let uploadsImages = [];
    if (images && images.length > 0) {
      for (const base64 of images) {
        const result = await cloudinary.uploader.upload(base64, {
          folder: "chat_app",
        });

        uploadsImages.push({
          url: result.secure_url,
          public_id: result.public_id,
        });
      }
    }
    const chat = new Chat({
      user_id: user._id,
      content: message,
      images: uploadsImages,
    });
    await chat.save();
    //trả data về client
    const payload = {
      user_id: user._id,
      content: message,
      avatar: user.avatar,
      images: uploadsImages,
    };
    io.emit("SERVER_RETURN_MASSAGE", payload);
  });
  //typing
  socket.on("CLIENT_SEND_TYPING", async (type) => {
    socket.broadcast.emit("SERVER_RETURN_TYPING", {
      user_id: user._id,
      type: type,
      avatar: user.avatar,
    });
  });

  //add friend
  socket.on("CLIENT_ADD_FRIEND", async (content) => {
    const { userId, text } = content;
    const myUserId = user._id;
    //thêm id của A vào acceptFriend của B
    const exitIdAinB = await User.findOne({
      _id: userId,
      "acceptFriends.id": myUserId,
    });
    if (!exitIdAinB) {
      await User.updateOne(
        {
          _id: userId,
        },
        {
          $push: { acceptFriends: { id: myUserId, message: text } },
        }
      );
    }
    const exitIdBinA = await User.findOne({
      _id: myUserId,
      "requestFriends.id": userId,
    });
    if (!exitIdBinA) {
      await User.updateOne(
        {
          _id: myUserId,
        },
        {
          $push: {
            requestFriends: { id: userId, message: text },
          },
        }
      );
    }
    socket.emit("SERVER_ADD_FRIEND_STATUS", {
      status: "pending",
    });
  });
  // const token = socket.handshake.auth.token;
  // //   get user detail
  // const user = await getUserDetail(token);
  // socket.join(user?._id);
  // onlineUser.add(user?._id?.toString());
  // io.emit("onlineUser", Array.from(onlineUser));
  // socket.on("Message_Page", async (userId) => {
  //   const userDetail = await User.findById(userId).select(
  //     "-password -refreshToken"
  //   );
  //   const payload = {
  //     _id: userDetail?._id,
  //     name: userDetail?.name,
  //     email: userDetail?.email,
  //     avatar: userDetail?.avatar,
  //     mobile: userDetail?.mobile,
  //     date_of_birth: userDetail?.date_of_birth,
  //     background: userDetail?.background,
  //     gender: userDetail?.gender,
  //     online: onlineUser.has(userId),
  //   };
  //   socket.emit("Message_user", payload);
  // });
  socket.on("disconnect", () => {
    // onlineUser.delete(user?._id);
    console.log("disconnect user", socket.id);
  });
});

module.exports = {
  app,
  server,
};
