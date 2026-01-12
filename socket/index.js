const express = require("express");
const User = require("../model/user.model");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
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
const onlineUser = new Map();

io.on("connection", async (socket) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) throw new Error("No token");

    const user = await getUserDetail(token);
    if (!user) throw new Error("Invalid token");
    const userId = user._id.toString();
    console.log("User connected:", userId);

    socket.join(userId);
    // Nhận room ID và join room
    socket.on("JOIN_ROOM", ({ roomChatId }) => {
      // leave room cũ nếu có
      if (socket.roomChatId) {
        socket.leave(socket.roomChatId);
      }
      socket.join(roomChatId);
      socket.roomChatId = roomChatId;
    });
    //user online

    //add socket
    if (!onlineUser.has(userId)) {
      onlineUser.set(userId, new Set());
    }
    onlineUser.get(userId).add(socket.id);
    //  GỬI DANH SÁCH ONLINE NGAY KHI CONNECT
    const onlineUsersPayload = {};
    for (const [uid, sockets] of onlineUser.entries()) {
      if (sockets.size > 0) {
        onlineUsersPayload[uid] = {
          status: "online",
          lastActive: null,
        };
      }
    }

    socket.emit("SERVER_ONLINE_USERS", onlineUsersPayload);
    //Nếu socket đầu tiên thì online
    if (onlineUser.get(userId).size === 1) {
      await User.updateOne({ _id: userId }, { status: "online" });
      socket.broadcast.emit("SERVER_USER_ONLINE", {
        userId: userId,
      });
    }

    console.log("connected user", userId, socket.id);
    //message
    socket.on("CLIENT_SEND_MESSAGE", async (content) => {
      const { message, images, roomChatId, file } = content;
      let uploadsImages = [];

      if (images && images.length > 0) {
        uploadsImages = await Promise.all(
          images.map(async (base64) => {
            const result = await cloudinary.uploader.upload(base64, {
              folder: "chat_app",
            });
            return { url: result.secure_url, public_id: result.public_id };
          })
        );
      }
      if (message || images) {
        const chat = new Chat({
          user_id: user._id,
          room_chat_id: roomChatId,
          content: message,
          images: uploadsImages,
        });
        await chat.save();
      }

      //Lấy room
      const room = await RoomChat.findById(roomChatId);
      //Tạo object tăng unread
      const incObj = {};
      room.users.forEach((u) => {
        const uid = u.user_id.toString();
        if (uid !== user._id.toString()) {
          incObj[`unreadCount.${uid}`] = 1;
        }
      });
      //Cập nhật room chat
      const now = new Date();
      await RoomChat.findByIdAndUpdate(roomChatId, {
        lastMessage: {
          content: message,
          images: uploadsImages,
          files: file ? file : [],
          sender: user._id,
          createdAt: now,
        },
        $inc: incObj,
        $set: { [`unreadCount.${user._id.toString()}`]: 0 },
      });

      //trả data về client
      const unreadCountForUsers = {};
      room.users.forEach((u) => {
        const uid = u.user_id.toString();
        unreadCountForUsers[uid] =
          uid === user._id.toString() ? 0 : (room.unreadCount?.[uid] || 0) + 1;
      });
      const payload = {
        // _id: chat._id,
        roomChatId,
        user_id: user._id,
        content: message,
        avatar: user.avatar,
        images: uploadsImages,
        files: file,
        createdAt: now,
        unreadCountForUsers,
      };
      io.to(roomChatId).emit("SERVER_RETURN_MASSAGE", payload);
      room.users.forEach((u) => {
        const sockets = onlineUser.get(u.user_id.toString());
        if (sockets) {
          sockets.forEach((sid) => {
            io.to(sid).emit("SERVER_RETURN_SIDEBAR", payload);
          });
        }
      });
    });

    //typing
    socket.on("CLIENT_SEND_TYPING", async (type) => {
      if (!socket.roomChatId) return;

      socket.broadcast.to(socket.roomChatId).emit("SERVER_RETURN_TYPING", {
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
      //trả về số lời mời kết bạn bên B
      const infoUserB = await User.findOne({
        _id: userId,
      });
      const lengthAcceptFriend = infoUserB.acceptFriends.length;

      socket.broadcast.emit("SEVER_RETURN_LENGTH_ACCEPT_FRIEND", {
        userId: userId,
        lengthAcceptFriend: lengthAcceptFriend,
      });
      //trả về thông tin A trong danh sách lời mời kết bạn của B
      const infoUserA = await User.findOne({
        _id: myUserId,
      }).select(" -password -googleId -refresh_token");

      socket.broadcast.emit("SERVER_RETURN_INFO_A", {
        userId: userId,
        infoUserA: infoUserA,
      });

      //trả về trạng thái nút button bên A
      socket.emit("SERVER_FRIEND_STATUS", {
        userId: userId,
        status: "pending",
      });
    });
    //cancel add friend
    socket.on("CLIENT_CANCEL_FRIEND", async (userId) => {
      const myUserId = user._id;
      //xóa id của A trong acceptFriend của B
      const exitIdAinB = await User.findOne({
        _id: userId,
        "acceptFriends.id": myUserId,
      });
      if (exitIdAinB) {
        await User.updateOne(
          {
            _id: userId,
          },
          {
            $pull: { acceptFriends: { id: myUserId } },
          }
        );
      }
      //xóa id của B trong requestFriend của A
      const exitIdBinA = await User.findOne({
        _id: myUserId,
        "requestFriends.id": userId,
      });
      if (exitIdBinA) {
        await User.updateOne(
          {
            _id: myUserId,
          },
          {
            $pull: { requestFriends: { id: userId } },
          }
        );
      }
      //trả về số lời mời kết bạn bên B
      const infoUserB = await User.findOne({
        _id: userId,
      });
      const lengthAcceptFriend = infoUserB.acceptFriends.length;

      socket.broadcast.emit("SEVER_RETURN_LENGTH_ACCEPT_FRIEND", {
        userId: userId,
        lengthAcceptFriend: lengthAcceptFriend,
      });
      //xóa thông tin A trong danh sách lời mời kết bạn bên B
      socket.broadcast.emit("SERVER_DELETE_INFO_A", {
        userIdB: userId,
        userIdA: myUserId,
      });
      //trả về trạng thái nút button bên A
      socket.emit("SERVER_FRIEND_STATUS", {
        userId: userId,
        status: "none",
      });
    });
    //refuse add friend
    socket.on("CLIENT_REFUSE_FRIEND", async (userId) => {
      const myUserId = user._id;

      //xóa id của A trong acceptFriend của B
      const exitIdAinB = await User.findOne({
        _id: myUserId,
        "acceptFriends.id": userId,
      });
      if (exitIdAinB) {
        await User.updateOne(
          {
            _id: myUserId,
          },
          {
            $pull: { acceptFriends: { id: userId } },
          }
        );
      }
      //xóa id của B trong requestFriend của A
      const exitIdBinA = await User.findOne({
        _id: userId,
        "requestFriends.id": myUserId,
      });
      if (exitIdBinA) {
        await User.updateOne(
          {
            _id: userId,
          },
          {
            $pull: { requestFriends: { id: myUserId } },
          }
        );
      }
      //xóa thông tin A trong danh sách lời mời kết bạn bên B
      socket.emit("SERVER_DELETE_INFO_A", {
        userIdB: myUserId,
        userIdA: userId,
      });
    });
    //accept add friend
    socket.on("CLIENT_ACCEPT_FRIEND", async (userId) => {
      const myUserId = user._id;

      const exitIdAinB = await User.exists({
        _id: myUserId,
        "acceptFriends.id": userId,
      });
      const exitIdBinA = await User.exists({
        _id: userId,
        "requestFriends.id": myUserId,
      });

      let roomChat;

      if (exitIdAinB && exitIdBinA) {
        const dataRoom = {
          typeRoom: "friend",
          users: [
            { user_id: userId, role: "superAdmin" },
            { user_id: myUserId, role: "superAdmin" },
          ],
        };
        roomChat = await new RoomChat(dataRoom).save();
      }

      if (exitIdAinB && roomChat) {
        await User.updateOne(
          { _id: myUserId },
          {
            $pull: { acceptFriends: { id: userId } },
            $addToSet: {
              FriendList: { user_id: userId, room_chat_id: roomChat._id },
            },
          }
        );
      }

      if (exitIdBinA && roomChat) {
        await User.updateOne(
          { _id: userId },
          {
            $pull: { requestFriends: { id: myUserId } },
            $addToSet: {
              FriendList: { user_id: myUserId, room_chat_id: roomChat._id },
            },
          }
        );
      }
    });
    //unfriend
    socket.on("CLIENT_UNFRIEND", async (userId) => {
      const myUserId = user._id;
      //lấy room chat giữa 2 người
      const myInfo = await User.findById(myUserId);
      const friendInfo = myInfo.FriendList.find(
        (item) => item.user_id === userId
      );
      if (!friendInfo) return;
      const roomChatId = friendInfo.room_chat_id;
      //xóa bạn bè khỏi danh sách bạn bè của 2 người
      await User.updateOne(
        { _id: myUserId },
        { $pull: { FriendList: { user_id: userId } } }
      );
      await User.updateOne(
        { _id: userId },
        { $pull: { FriendList: { user_id: myUserId } } }
      );
      //xóa room chat
      await RoomChat.findByIdAndDelete(roomChatId);
      //xóa tin nhắn trong room chat
      await Chat.deleteMany({ room_chat_id: roomChatId });
      //  realtime cho 2 người
      io.to(myUserId.toString()).emit("SERVER_UNFRIEND_SUCCESS", {
        friendId: userId,
        roomChatId,
      });

      io.to(userId.toString()).emit("SERVER_UNFRIEND_SUCCESS", {
        friendId: myUserId.toString(),
        roomChatId,
      });
    });
    //client seen meessage in sibar
    socket.on("CLIENT_READ_ROOM", async ({ roomChatId }) => {
      if (!roomChatId) return;

      await RoomChat.findByIdAndUpdate(roomChatId, {
        $set: {
          [`unreadCount.${userId}`]: 0,
        },
      });

      io.to(roomChatId).emit("SERVER_READ_ROOM", {
        roomChatId,
        userId,
      });
    });
    //client update room info
    socket.on("CLIENT_UPDATE_ROOM_INFO", async (data) => {
      const { roomChatId, title, avatar } = data;

      if (!roomChatId) return;
      const systemMsg = await Chat.create({
        room_chat_id: roomChatId,
        user_id: user._id,
        type: "system",
        action: "rename_group",
        content: title,
      });
      const populatedMsg = await Chat.findById(systemMsg._id).populate(
        "user_id",
        "name"
      );
      io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
      io.to(roomChatId).emit("SERVER_ROOM_UPDATED", {
        title,
        avatar,
      });
    });
    //client add member
    socket.on("CLIENT_ADD_MEMBER", async (data) => {
      const { roomChatId, member } = data;
      if (!roomChatId) return;

      // Lấy info user mới thêm
      const newUsers = await User.find(
        { _id: { $in: member } },
        "name avatar lastActive"
      );

      const systemMsg = await Chat.create({
        room_chat_id: roomChatId,
        user_id: user._id,
        type: "system",
        action: "add_member",
        content_user: member,
      });
      const roomChat = await RoomChat.findById(roomChatId).populate(
        "users.user_id",
        "name avatar lastActive"
      );

      const populatedMsg = await Chat.findById(systemMsg._id)
        .populate("user_id", "name")
        .populate("content_user", "name");

      io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);

      io.to(roomChatId).emit("SERVER_ROOM_UPDATED_USER", {
        users: newUsers.map((u) => ({
          user_id: u,
          role: "member",
        })),
      });
      // 2. Update sibar cho user mới được thêm
      for (const userId of member) {
        io.to(userId.toString()).emit("SERVER_ROOM_UPDATED_SIDEBAR", {
          roomChat,
        });
      }
    });
    //client remove member
    socket.on("CLIENT_REMOVE_MEMBER", async (data) => {
      const { roomChatId, member } = data;

      if (!roomChatId) return;
      const systemMsg = await Chat.create({
        room_chat_id: roomChatId,
        user_id: user._id,
        type: "system",
        action: "remove_member",
        content_user: member,
      });
      const roomChat = await RoomChat.findById(roomChatId)
        .select("title typeRoom avatar users")
        .populate({
          path: "users.user_id",
          select: "name avatar lastActive ",
        });

      const populatedMsg = await Chat.findById(systemMsg._id)
        .populate("user_id", "name")
        .populate("content_user", "name");
      io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
      io.to(roomChatId).emit("SERVER_ROOM_REMOVE_USERS", {
        roomChatId,
        users: roomChat.users,
        removedUserId: member,
        action: "remove",
      });
    });
    //client leave group in roomChat
    socket.on("CLIENT_LEAVE_GROUP", async (data) => {
      const { roomChatId } = data;

      if (!roomChatId) return;
      const systemMsg = await Chat.create({
        room_chat_id: roomChatId,
        user_id: user._id,
        type: "system",
        action: "leave_group",
        content_user: user._id,
      });
      const roomChat = await RoomChat.findById(roomChatId)
        .select("title typeRoom avatar users")
        .populate({
          path: "users.user_id",
          select: "name avatar lastActive ",
        });

      const populatedMsg = await Chat.findById(systemMsg._id)
        .populate("user_id", "name")
        .populate("content_user", "name");
      io.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
      io.to(roomChatId).emit("SERVER_ROOM_REMOVE_USERS", {
        roomChatId,
        users: roomChat.users,
        removedUserId: user._id,
        action: "leave",
      });
    });
    //client leave group-trả về danh sách group hiện tại
    socket.on("CLIENT_LEAVE_ROOM_PERSON", async ({ roomChatId }) => {
      socket.leave(roomChatId);
      // gửi cho người rời
      socket.emit("SERVER_LEAVE_ROOM_PERSON", {
        roomChatId,
      });
      const systemMsg = await Chat.create({
        room_chat_id: roomChatId,
        user_id: user._id,
        type: "system",
        action: "leave_group",
        content_user: user._id,
      });
      const roomChat = await RoomChat.findById(roomChatId)
        .select("title typeRoom avatar users")
        .populate({
          path: "users.user_id",
          select: "name avatar lastActive ",
        });
      // gửi cho người còn lại
      const populatedMsg = await Chat.findById(systemMsg._id)
        .populate("user_id", "name")
        .populate("content_user", "name");
      socket.to(roomChatId).emit("SERVER_NEW_MESSAGE", populatedMsg);
      io.to(roomChatId).emit("SERVER_ROOM_REMOVE_USERS", {
        roomChatId,
        users: roomChat.users,
        removedUserId: userId,
        action: "leave",
      });

      socket.to(roomChatId).emit("SERVER_ROOM_UPDATED", {
        roomChatId,
        userId,
      });
    });

    //client remove roomChat
    socket.on("CLIENT_REMOVE_ROOM", async (data) => {
      const { roomChatId } = data;

      io.in(roomChatId).emit("SERVER_RETURN_ROOM", { roomChatId });
    });
    //client create room
    socket.on("CLIENT_CREATE_ROOM", ({ room }) => {
      room.users.forEach((member) => {
        io.to(member.user_id.toString()).emit("SERVER_RETURN_NEW_ROOM", room);
      });
    });

    //disconnect
    socket.on("disconnect", async () => {
      const sockets = onlineUser.get(userId);
      if (!sockets) return;
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUser.delete(userId);
        const lastActive = new Date();
        await User.updateOne(
          { _id: userId },
          { status: "offline", lastActive }
        );
        socket.broadcast.emit("SERVER_USER_OFFLINE", {
          userId: userId,
          lastActive,
        });
      }
      console.log("disconnect user", socket.id);
    });
  } catch (error) {
    console.log("Socket auth failed:", err.message);
    socket.disconnect(true);
  }
});

module.exports = {
  app,
  server,
};
