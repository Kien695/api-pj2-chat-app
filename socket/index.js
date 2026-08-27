const express = require("express");
const User = require("../model/user.model");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const { Server } = require("socket.io");
const http = require("http");
const { getUserDetail } = require("../helper/getUserFormToken");
const socketAsyncHandler = require("../utils/socketAsyncHandler");
const {
  acceptFriendRequest,
  addFriendRequest,
  cancelFriendRequest,
  refuseFriendRequest,
  unfriend,
} = require("../service/friendship.service");
const { persistMessage } = require("../service/messagePersistence.service");
const {
  cleanupAssets,
  uploadImagesWithCompensation,
} = require("../service/cloudinaryAsset.service");
const {
  validateMessagePayload,
} = require("../service/messagePayloadValidation.service");
const {
  RoomAuthorizationError,
  requireMessageOwner,
  requireRoomMember,
  requireRoomMembers,
} = require("../service/roomAuthorization.service");
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

const returnSocketError = (socket, event, error, args = []) => {
  const acknowledgement = args.at(-1);
  const payload = {
    success: false,
    error: true,
    event,
    code: "SOCKET_OPERATION_FAILED",
    message: "Không thể thực hiện thao tác realtime",
  };

  console.error(`Socket operation failed: ${event}`, error);

  if (typeof acknowledgement === "function") {
    acknowledgement(payload);
  } else {
    socket.emit("SERVER_SOCKET_ERROR", payload);
  }
};

const registerAsyncSocketHandler = (socket, event, handler, onError) => {
  socket.on(
    event,
    socketAsyncHandler(handler, (error, args) => {
      if (onError) {
        return onError(error, args);
      }
      return returnSocketError(socket, event, error, args);
    }),
  );
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
    registerAsyncSocketHandler(socket, "JOIN_ROOM", async ({ roomChatId } = {}, acknowledgement) => {
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
    registerAsyncSocketHandler(socket, "CLIENT_SEND_MESSAGE", async (content = {}, acknowledgement) => {
      try {
        const { roomChatId, clientMessageId } = content;
        const validatedMessage = validateMessagePayload(content);
        const {
          message,
          images,
          files: file,
          type,
        } = validatedMessage;

        if (
          typeof clientMessageId !== "string" ||
          clientMessageId.trim().length === 0 ||
          clientMessageId.length > 100
        ) {
          throw new RoomAuthorizationError(
            400,
            "INVALID_CLIENT_MESSAGE_ID",
            "Mã tin nhắn không hợp lệ",
          );
        }

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
        await requireRoomMembers(roomIds, userId);

        let uploadsImages = [];

        if (images && images.length > 0) {
          uploadsImages = await uploadImagesWithCompensation(images);
        }
        const results = [];
        for (const authorizedRoomId of roomIds) {
          try {
            const persisted = await persistMessage({
              roomId: authorizedRoomId,
              userId,
              clientMessageId: clientMessageId.trim(),
              content: message,
              images: uploadsImages,
              files: Array.isArray(file) ? file : [],
              type,
            });
            const unreadCountForUsers = {};
            persisted.room.users.forEach((member) => {
              const memberId = member.user_id.toString();
              unreadCountForUsers[memberId] =
                persisted.room.unreadCount?.[memberId] || 0;
            });

            const payload = {
              _id: persisted.message._id,
              clientMessageId: persisted.message.clientMessageId,
              roomChatId: authorizedRoomId,
              user_id: user._id,
              content: persisted.message.content,
              avatar: user.avatar,
              images: persisted.message.images,
              files: persisted.message.files,
              type: persisted.message.type,
              createdAt: persisted.message.createdAt,
              unreadCountForUsers,
            };

            if (!persisted.duplicate) {
              io.to(authorizedRoomId).emit("SERVER_RETURN_MASSAGE", payload);
              persisted.room.users.forEach((member) => {
                const sockets = onlineUser.get(member.user_id.toString());
                sockets?.forEach((socketId) => {
                  io.to(socketId).emit("SERVER_RETURN_SIDEBAR", payload);
                });
              });
            }

            results.push({
              roomChatId: authorizedRoomId,
              success: true,
              messageId: persisted.message._id,
              duplicate: persisted.duplicate,
            });
          } catch (error) {
            console.error("Message persistence failed", {
              roomChatId: authorizedRoomId,
              userId,
              clientMessageId,
              error,
            });
            results.push({
              roomChatId: authorizedRoomId,
              success: false,
              code: error.code || "MESSAGE_PERSISTENCE_FAILED",
            });
          }
        }

        const response = {
          success: results.every((result) => result.success),
          clientMessageId: clientMessageId.trim(),
          results,
        };
        const uploadedAssetsAreUnreferenced =
          uploadsImages.length > 0 &&
          !results.some((result) => result.success && !result.duplicate);
        if (uploadedAssetsAreUnreferenced) {
          await cleanupAssets(uploadsImages).catch((cleanupError) => {
            console.error("Rejected message upload cleanup failed", cleanupError);
          });
        }
        if (typeof acknowledgement === "function") {
          acknowledgement(response);
        } else if (!response.success) {
          socket.emit("SERVER_ROOM_ERROR", {
            ...response,
            error: true,
            event: "CLIENT_SEND_MESSAGE",
            code: "MESSAGE_PERSISTENCE_FAILED",
            message: "Không thể gửi tin nhắn đến một hoặc nhiều phòng",
          });
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
    registerAsyncSocketHandler(
      socket,
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
    registerAsyncSocketHandler(socket, "CLIENT_SEND_TYPING", async (type, acknowledgement) => {
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
    registerAsyncSocketHandler(socket, "CLIENT_ADD_FRIEND", async (content) => {
      const { userId, text } = content;

      const myUserId = user._id;
      await addFriendRequest(myUserId, userId, text);

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
    registerAsyncSocketHandler(socket, "CLIENT_CANCEL_FRIEND", async (userId) => {
      const myUserId = user._id;
      await cancelFriendRequest(myUserId, userId);
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
    registerAsyncSocketHandler(socket, "CLIENT_REFUSE_FRIEND", async (userId) => {
      const myUserId = user._id;
      await refuseFriendRequest(myUserId, userId);
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
    registerAsyncSocketHandler(socket, "CLIENT_ACCEPT_FRIEND", async (userId) => {
      const myUserId = user._id;
      await acceptFriendRequest(myUserId, userId);
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
    registerAsyncSocketHandler(socket, "CLIENT_UNFRIEND", async (userId) => {
      const myUserId = user._id;
      const roomChatId = await unfriend(myUserId, userId);
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
    registerAsyncSocketHandler(
      socket,
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
    registerAsyncSocketHandler(socket, "disconnect", async () => {
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
    }, (error) => {
      console.error("Socket disconnect cleanup failed", {
        socketId: socket.id,
        userId,
        error,
      });
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
