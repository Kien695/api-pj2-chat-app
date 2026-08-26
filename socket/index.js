const express = require("express");
const User = require("../model/user.model");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const { Server } = require("socket.io");
const http = require("http");
const { getUserDetail } = require("../helper/getUserFormToken");
const {
  RoomAuthorizationError,
  requireMessageOwner,
  requireRoomMember,
  requireRoomMembers,
} = require("../service/roomAuthorization.service");
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

const activeCalls = new Map();

//online user
const onlineUser = new Map();

const returnRoomSocketError = (socket, event, error, acknowledgement) => {
  const isAuthorizationError = error instanceof RoomAuthorizationError;
  const payload = {
    success: false,
    error: true,
    event,
    code: isAuthorizationError ? error.code : "ROOM_OPERATION_FAILED",
    message: isAuthorizationError
      ? error.message
      : "Không thể thực hiện thao tác phòng chat",
  };

  if (!isAuthorizationError) {
    console.error(`Socket room operation failed: ${event}`, error);
  }

  if (typeof acknowledgement === "function") {
    acknowledgement(payload);
  } else {
    socket.emit("SERVER_ROOM_ERROR", payload);
  }
};

io.on("connection", async (socket) => {
  try {
    //qr code
    socket.on("JOIN_QR", (sessionId) => {
      console.log("Socket đã nhận", sessionId);
      socket.join(sessionId);
    });
    const token = socket.handshake.auth.token;
    if (!token) {
      console.log("PC chưa login kết nối Socket thành công (đang chờ quét QR)");
      return;
    }

    const user = await getUserDetail(token);
    if (!user) throw new Error("Invalid token");
    const userId = user._id.toString();
    console.log("User connected:", userId);

    socket.join(userId);
    // Nhận room ID và join room
    socket.on("JOIN_ROOM", async ({ roomChatId } = {}, acknowledgement) => {
      try {
        await requireRoomMember(roomChatId, userId);

        // Chỉ leave room cũ sau khi room mới đã được xác thực.
        if (socket.roomChatId && socket.roomChatId !== roomChatId) {
          await socket.leave(socket.roomChatId);
        }
        await socket.join(roomChatId);
        socket.roomChatId = roomChatId;

        if (typeof acknowledgement === "function") {
          acknowledgement({ success: true, roomChatId });
        }
      } catch (error) {
        returnRoomSocketError(socket, "JOIN_ROOM", error, acknowledgement);
      }
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
    socket.on("CLIENT_SEND_MESSAGE", async (content = {}, acknowledgement) => {
      try {
        const { message, images, roomChatId, file, type } = content;

        const requestedRoomIds = Array.isArray(roomChatId)
          ? roomChatId
          : [roomChatId];
        const roomIds = [...new Set(requestedRoomIds)];

        if (roomIds.length === 0 || roomIds.length > 100) {
          throw new RoomAuthorizationError(
            400,
            "INVALID_ROOM_ID",
            "Danh sách phòng chat không hợp lệ",
          );
        }

        // Xác thực toàn bộ target trước upload để tránh ghi một phần hoặc tốn phí.
        const roomsById = await requireRoomMembers(roomIds, userId);

        let uploadsImages = [];

        if (images && images.length > 0) {
          uploadsImages = await Promise.all(
            images.map(async (base64) => {
              const result = await cloudinary.uploader.upload(base64, {
                folder: "chat_app",
              });
              return { url: result.secure_url, public_id: result.public_id };
            }),
          );
        }
        for (const authorizedRoomId of roomIds) {
          const room = roomsById.get(authorizedRoomId);
          //Tạo object tăng unread
          const incObj = {};
          room.users.forEach((u) => {
            const uid = u.user_id.toString();
            if (uid !== user._id.toString()) {
              incObj[`unreadCount.${uid}`] = 1;
            }
          });
          //Cập nhật room chat với membership trong cùng điều kiện query.
          const now = new Date();

          const updatedRoom = await RoomChat.findOneAndUpdate(
            { _id: authorizedRoomId, "users.user_id": userId },
            {
              lastMessage: {
                content: message,
                images: uploadsImages,
                files: file ? file : [],
                sender: user._id,
                createdAt: now,
                type: type,
              },
              $inc: incObj,
              $set: { [`unreadCount.${user._id.toString()}`]: 0 },
            },
            { new: true },
          );

          if (!updatedRoom) {
            throw new RoomAuthorizationError(
              403,
              "ROOM_ACCESS_DENIED",
              "Bạn không còn quyền truy cập phòng chat này",
            );
          }

          if (
            type === "emoji" ||
            message?.trim() ||
            uploadsImages.length > 0
          ) {
            await Chat.create({
              user_id: user._id,
              room_chat_id: authorizedRoomId,
              content: message,
              images: uploadsImages,
              type,
            });
          }

          //trả data về client
          const unreadCountForUsers = {};
          updatedRoom.users.forEach((u) => {
            const uid = u.user_id.toString();
            unreadCountForUsers[uid] = updatedRoom.unreadCount?.[uid] || 0;
          });

          const payload = {
            roomChatId: authorizedRoomId,
            user_id: user._id,
            content: message,
            avatar: user.avatar,
            images: uploadsImages,
            files: file,
            type: type,
            createdAt: now,
            unreadCountForUsers,
          };
          console.log(payload);
          io.to(authorizedRoomId).emit("SERVER_RETURN_MASSAGE", payload);
          room.users.forEach((u) => {
            const sockets = onlineUser.get(u.user_id.toString());
            if (sockets) {
              sockets.forEach((sid) => {
                io.to(sid).emit("SERVER_RETURN_SIDEBAR", payload);
              });
            }
          });
        }

        if (typeof acknowledgement === "function") {
          acknowledgement({ success: true });
        }
      } catch (error) {
        returnRoomSocketError(
          socket,
          "CLIENT_SEND_MESSAGE",
          error,
          acknowledgement,
        );
      }
    });
    //remove message
    socket.on(
      "CLIENT_REMOVE_MESSAGE",
      async ({ selectedMessageId, roomChatId } = {}, acknowledgement) => {
        try {
          const message = await requireMessageOwner(
            selectedMessageId,
            roomChatId,
            userId,
          );

          await Chat.findOneAndUpdate(
            {
              _id: message._id,
              room_chat_id: roomChatId,
              user_id: userId,
            },
            {
              deleted: true,
              deletedAt: new Date(),
            },
          );

          io.to(roomChatId).emit("SERVER_MESSAGE_DELETED", selectedMessageId);

          if (typeof acknowledgement === "function") {
            acknowledgement({ success: true });
          }
        } catch (error) {
          returnRoomSocketError(
            socket,
            "CLIENT_REMOVE_MESSAGE",
            error,
            acknowledgement,
          );
        }
      },
    );

    //typing
    socket.on("CLIENT_SEND_TYPING", async (type, acknowledgement) => {
      try {
        if (!socket.roomChatId) return;
        await requireRoomMember(socket.roomChatId, userId);

        socket.broadcast.to(socket.roomChatId).emit("SERVER_RETURN_TYPING", {
          user_id: user._id,
          type: type,
          avatar: user.avatar,
        });
      } catch (error) {
        returnRoomSocketError(
          socket,
          "CLIENT_SEND_TYPING",
          error,
          acknowledgement,
        );
      }
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
          },
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
          },
        );
      }

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
          },
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
          },
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
          },
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
          },
        );
      }
      //xóa thông tin A trong danh sách lời mời kết bạn bên B
      socket.emit("SERVER_DELETE_INFO_A", {
        userIdB: myUserId,
        userIdA: userId,
      });
      //trả về trạng thái nút button bên A
      io.to(userId).emit("SERVER_FRIEND_STATUS", {
        userId: myUserId,
        status: "none",
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
          },
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
          },
        );
      }
      //xóa thông tin A trong danh sách lời mời kết bạn bên B
      socket.emit("SERVER_DELETE_INFO_A", {
        userIdB: myUserId,
        userIdA: userId,
      });
      //trả về thông tin A trong danh sách bạn bè của B
      const infoUserA = await User.findOne({
        _id: myUserId,
      }).select(" -password -googleId -refresh_token");
      //trả về thông tin B trong danh sách bạn bè của A
      const infoUserB = await User.findOne({
        _id: userId,
      }).select(" -password -googleId -refresh_token");
      //  realtime cho 2 người
      io.to(myUserId.toString()).emit("SERVER_RETURN_LIST_FRIEND", {
        friend: infoUserB,
      });

      io.to(userId).emit("SERVER_RETURN_LIST_FRIEND", {
        friend: infoUserA,
      });
    });
    //unfriend
    socket.on("CLIENT_UNFRIEND", async (userId) => {
      const myUserId = user._id;
      //lấy room chat giữa 2 người
      const myInfo = await User.findById(myUserId);
      const friendInfo = myInfo.FriendList.find(
        (item) => item.user_id === userId,
      );
      if (!friendInfo) return;
      const roomChatId = friendInfo.room_chat_id;
      //xóa bạn bè khỏi danh sách bạn bè của 2 người
      await User.updateOne(
        { _id: myUserId },
        { $pull: { FriendList: { user_id: userId } } },
      );
      await User.updateOne(
        { _id: userId },
        { $pull: { FriendList: { user_id: myUserId } } },
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
    socket.on(
      "CLIENT_READ_ROOM",
      async ({ roomChatId } = {}, acknowledgement) => {
        try {
          await requireRoomMember(roomChatId, userId);

          const updatedRoom = await RoomChat.findOneAndUpdate(
            { _id: roomChatId, "users.user_id": userId },
            {
              $set: {
                [`unreadCount.${userId}`]: 0,
              },
            },
          );
          if (!updatedRoom) {
            throw new RoomAuthorizationError(
              403,
              "ROOM_ACCESS_DENIED",
              "Bạn không còn quyền truy cập phòng chat này",
            );
          }

          io.to(roomChatId).emit("SERVER_READ_ROOM", {
            roomChatId,
            userId,
          });

          if (typeof acknowledgement === "function") {
            acknowledgement({ success: true });
          }
        } catch (error) {
          returnRoomSocketError(
            socket,
            "CLIENT_READ_ROOM",
            error,
            acknowledgement,
          );
        }
      },
    );
    // Handle outgoing call request
    socket.on("callToUser", (data) => {
      const calleeSockets = onlineUser.get(data.callToUserId);

      if (!calleeSockets?.size) {
        socket.emit("userUnavailable", {
          message: "Người dùng hiện chưa đang truy cập!.",
        }); //  Notify caller if user is offline
        return;
      }

      const calleeId = [...calleeSockets][0];

      //  If the user is already in another call
      if (activeCalls.has(data.callToUserId)) {
        socket.emit("userBusy", {
          message: "Người dùng đang trong cuộc gọi khác!",
        });

        io.to(calleeId).emit("incomingCallWhileBusy", {
          from: data.from,
          name: data.name,
          email: data.email,
          profilepic: data.profilepic,
        });

        return;
      }

      //  Emit an event to the receiver's socket (callee)
      io.to(calleeId).emit("makeUser", {
        signal: data.signalData, // WebRTC signal data
        from: data.from, // Caller ID
        name: data.name, // Caller name
        email: data.email, // Caller email
        profilepic: data.profilepic, // Caller profile picture
        type: data.type,
      });
    });
    //  Handle when a call is accepted
    socket.on("answeredCall", (data) => {
      const sockets = onlineUser.get(data.to);

      if (!sockets?.size) return;
      const socketId = [...sockets][0];
      io.to(socketId).emit("callAccepted", {
        signal: data.signal, // WebRTC signal
        from: data.from, // Caller ID
      });

      //  Track active calls in a Map
      activeCalls.set(data.from, { with: data.to, socketId: socket.id });
      activeCalls.set(data.to, { with: data.from, socketId: socketId });
    });
    // Handle call rejection
    socket.on("reject-call", (data) => {
      io.to(data.to).emit("callRejected", {
        name: data.name,
        profilepic: data.profilepic,
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
          { status: "offline", lastActive },
        );
        socket.broadcast.emit("SERVER_USER_OFFLINE", {
          userId: userId,
          lastActive,
        });
      }
      console.log("disconnect user", socket.id);
    });
  } catch (error) {
    console.log("Socket auth failed:", error.message);
    socket.disconnect(true);
  }
});
const getIO = () => {
  if (!io) {
    throw new Error("Socket chưa được khởi tạo");
  }
  return io;
};
module.exports = {
  app,
  server,
  getIO,
};
