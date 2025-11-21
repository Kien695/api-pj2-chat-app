const express = require("express");
const User = require("../model/user.model");
const Chat = require("../model/chat.model");
const { Server } = require("socket.io");
const http = require("http");
const { getUserDetail } = require("../helper/getUserFormToken");

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

  socket.on("CLIENT_SEND_MASSAGE", async (content) => {
    const chat = new Chat({
      user_id: user._id,
      content: content,
    });
    await chat.save();
    //trả data về client
    const payload = {
      user_id: user._id,
      content: content,
      avatar: user.avatar,
    };
    io.emit("SERVER_RETURN_MASSAGE", payload);
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
