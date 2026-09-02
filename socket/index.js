const express = require("express");
const User = require("../model/user.model");
const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const { Server } = require("socket.io");
const http = require("http");
const { randomUUID } = require("crypto");
const socketAsyncHandler = require("../utils/socketAsyncHandler");
const {
  socketAuthenticationMiddleware,
} = require("../service/socketAuthentication.service");
const {
  QrSessionSecurityError,
  authorizeQrSubscription,
} = require("../service/qrSessionSecurity.service");
const {
  CallSignalingError,
  requireCallPermission,
  validateCallAction,
  validateCallRequest,
  validateCallResponse,
} = require("../service/callSignalingSecurity.service");
const {
  acceptFriendRequest,
  addFriendRequest,
  cancelFriendRequest,
  refuseFriendRequest,
  unfriend,
} = require("../service/friendship.service");
const { persistMessage } = require("../service/messagePersistence.service");
const {
  validateMessagePayload,
} = require("../service/messagePayloadValidation.service");
const {
  RoomAuthorizationError,
  requireMessageOwner,
  requireRoomMember,
  requireRoomMembers,
} = require("../service/roomAuthorization.service");
const {
  SocketRateLimitError,
  enforceSocketRateLimit,
} = require("../service/socketRateLimit.service");
const {
  SocketPayloadValidationError,
  validateFriendRequestPayload,
  validateFriendTarget,
  validateMessageRemovalPayload,
  validateRoomActionPayload,
  validateTypingPayload,
} = require("../service/socketPayloadValidation.service");
const {
  isPresenceOnline,
  listOnlineUserIds,
  removePresence,
  upsertPresence,
} = require("../service/presence.service");
const {
  CallStateError,
  acceptPendingCall,
  cleanupCallsForSocket,
  createPendingCall,
  endCall,
  rejectPendingCall,
} = require("../service/callState.service");
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

io.use(socketAuthenticationMiddleware);

const returnCallSocketError = (socket, event, error, args) => {
  const acknowledgement = args.at(-1);
  const isCallError = error instanceof CallSignalingError;
  const isRateLimitError = error instanceof SocketRateLimitError;
  const response = {
    success: false,
    error: true,
    event,
    code: isRateLimitError
      ? error.code
      : isCallError
        ? error.code
        : "CALL_SIGNALING_FAILED",
    message: isCallError ? error.message : "Không thể thực hiện thao tác cuộc gọi",
  };
  if (isRateLimitError) {
    response.message = error.message;
    response.retryAfterSeconds = error.retryAfterSeconds;
  }
  if (!isCallError && !isRateLimitError) console.error(`Call signaling failed: ${event}`, error);
  if (typeof acknowledgement === "function") acknowledgement(response);
  else socket.emit("SERVER_SOCKET_ERROR", response);
};

const returnRoomSocketError = (socket, event, error, acknowledgement) => {
  const isAuthorizationError = error instanceof RoomAuthorizationError;
  const isRateLimitError = error instanceof SocketRateLimitError;
  const isValidationError = error instanceof SocketPayloadValidationError;
  const payload = {
    success: false,
    error: true,
    event,
    code: isRateLimitError || isValidationError
      ? error.code
      : isAuthorizationError
        ? error.code
        : "ROOM_OPERATION_FAILED",
    message: isAuthorizationError
      ? error.message
      : "Không thể thực hiện thao tác phòng chat",
  };

  if (isRateLimitError) {
    payload.message = error.message;
    payload.retryAfterSeconds = error.retryAfterSeconds;
  }
  if (isValidationError) payload.message = error.message;
  if (!isAuthorizationError && !isRateLimitError && !isValidationError) {
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
  const isValidationError = error instanceof SocketPayloadValidationError;
  const payload = {
    success: false,
    error: true,
    event,
    code: isValidationError ? error.code : "SOCKET_OPERATION_FAILED",
    message: "Không thể thực hiện thao tác realtime",
  };

  if (isValidationError) payload.message = error.message;
  else console.error(`Socket operation failed: ${event}`, error);

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
    registerAsyncSocketHandler(
      socket,
      "JOIN_QR",
      async (payload, acknowledgement) => {
        const { sessionId, roomName } = await authorizeQrSubscription(payload);
        if (socket.qrRoomName && socket.qrRoomName !== roomName) {
          await socket.leave(socket.qrRoomName);
        }
        await socket.join(roomName);
        socket.qrRoomName = roomName;
        if (typeof acknowledgement === "function") {
          acknowledgement({ success: true, sessionId });
        }
      },
      (error, args) => {
        const acknowledgement = args.at(-1);
        const isQrError = error instanceof QrSessionSecurityError;
        const response = {
          success: false,
          error: true,
          event: "JOIN_QR",
          code: isQrError ? error.code : "QR_SUBSCRIPTION_FAILED",
          message: isQrError ? error.message : "Không thể theo dõi phiên QR",
        };
        if (!isQrError) console.error("QR subscription failed", error);
        if (typeof acknowledgement === "function") acknowledgement(response);
        else socket.emit("SERVER_SOCKET_ERROR", response);
      },
    );
    const user = socket.data.authenticatedUser;
    if (!user) {
      console.log("PC chưa login kết nối Socket thành công (đang chờ quét QR)");
      return;
    }
    const userId = user._id.toString();
    console.log("User connected:", userId);

    socket.join(userId);
    const distributedSocketCount = await upsertPresence({
      userId,
      socketId: socket.id,
    });
    const presenceHeartbeat = setInterval(() => {
      upsertPresence({ userId, socketId: socket.id }).catch((error) => {
        console.error("Socket presence heartbeat failed", {
          socketId: socket.id,
          userId,
          error,
        });
      });
    }, 30_000);
    presenceHeartbeat.unref?.();
    // Nhận room ID và join room
    registerAsyncSocketHandler(socket, "JOIN_ROOM", async (payload, acknowledgement) => {
      try {
        const { roomChatId } = validateRoomActionPayload(payload);
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
    const onlineUserIds = await listOnlineUserIds();
    const onlineUsersPayload = Object.fromEntries(
      onlineUserIds.map((uid) => [
        uid,
        { status: "online", lastActive: null },
      ]),
    );

    socket.emit("SERVER_ONLINE_USERS", onlineUsersPayload);
    //Nếu socket đầu tiên thì online
    if (distributedSocketCount === 1) {
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
        if (images.length > 0 && roomIds.length !== 1) {
          throw new RoomAuthorizationError(
            400,
            "IMAGE_SINGLE_ROOM_REQUIRED",
            "Tin nhắn có ảnh chỉ được gửi đến một phòng",
          );
        }

        await enforceSocketRateLimit("message", userId, roomIds.length);

        // Xác thực toàn bộ target trước upload để tránh ghi một phần hoặc tốn phí.
        await requireRoomMembers(roomIds, userId);

        const results = [];
        for (const authorizedRoomId of roomIds) {
          try {
            const persisted = await persistMessage({
              roomId: authorizedRoomId,
              userId,
              clientMessageId: clientMessageId.trim(),
              content: message,
              images,
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
                io.to(member.user_id.toString()).emit(
                  "SERVER_RETURN_SIDEBAR",
                  payload,
                );
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
      async (payload, acknowledgement) => {
        try {
          const { selectedMessageId, roomChatId } =
            validateMessageRemovalPayload(payload);
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
        type = validateTypingPayload(type);
        await enforceSocketRateLimit("typing", userId);
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
      const myUserId = user._id;
      const { userId, text } = validateFriendRequestPayload(content, myUserId);
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
      userId = validateFriendTarget(userId, myUserId);
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
      userId = validateFriendTarget(userId, myUserId);
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
      userId = validateFriendTarget(userId, myUserId);
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
      userId = validateFriendTarget(userId, myUserId);
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
      async (payload, acknowledgement) => {
        try {
          const { roomChatId } = validateRoomActionPayload(payload);
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
    registerAsyncSocketHandler(socket, "callToUser", async (data, acknowledgement) => {
      const { calleeId, signal, type } = validateCallRequest(data, userId);
      await enforceSocketRateLimit("callStart", userId);
      await requireCallPermission(userId, calleeId);

      if (!(await isPresenceOnline({ userId: calleeId }))) {
        socket.emit("userUnavailable", { message: "Người dùng hiện không trực tuyến" });
        return;
      }

      const callId = randomUUID();
      try {
        await createPendingCall({
          callId,
          callerId: userId,
          calleeId,
          callerSocketId: socket.id,
          type,
        });
      } catch (error) {
        if (error instanceof CallStateError && error.code === "USER_BUSY") {
          socket.emit("userBusy", { message: "Người dùng đang trong cuộc gọi khác" });
          return;
        }
        throw error;
      }

      io.to(calleeId).emit("makeUser", {
        callId,
        signal,
        from: userId,
        name: user.name,
        email: user.email,
        profilepic: user.avatar,
        type,
      });
      if (typeof acknowledgement === "function") acknowledgement({ success: true, callId });
    }, (error, args) => returnCallSocketError(socket, "callToUser", error, args));

    registerAsyncSocketHandler(socket, "answeredCall", async (data, acknowledgement) => {
      const { callId, signal } = validateCallResponse(data);
      await enforceSocketRateLimit("callAction", userId);
      let acceptedCall;
      try {
        acceptedCall = await acceptPendingCall({
          callId,
          calleeId: userId,
          calleeSocketId: socket.id,
        });
      } catch (error) {
        if (error instanceof CallStateError) {
          if (error.code === "CALL_RESPONSE_DENIED") {
            throw new CallSignalingError(403, error.code, "Không có quyền trả lời cuộc gọi này");
          }
          throw new CallSignalingError(409, "CALL_ALREADY_ANSWERED", "Cuộc gọi không còn chờ trả lời");
        }
        throw error;
      }

      socket.to(userId).emit("callAnsweredElsewhere", { callId });
      io.to(acceptedCall.callerSocketId).emit("callAccepted", {
        callId,
        signal,
        from: userId,
      });
      if (typeof acknowledgement === "function") acknowledgement({ success: true, callId });
    }, (error, args) => returnCallSocketError(socket, "answeredCall", error, args));

    registerAsyncSocketHandler(socket, "reject-call", async (data, acknowledgement) => {
      const callId = validateCallAction(data);
      await enforceSocketRateLimit("callAction", userId);
      let rejectedCall;
      try {
        rejectedCall = await rejectPendingCall({
          callId,
          actorId: userId,
          actorSocketId: socket.id,
        });
      } catch (error) {
        if (error instanceof CallStateError) {
          if (error.code === "CALL_ACTION_DENIED") {
            throw new CallSignalingError(403, "CALL_REJECTION_DENIED", "Không có quyền từ chối cuộc gọi này");
          }
          throw new CallSignalingError(409, "CALL_NOT_PENDING", "Cuộc gọi không còn chờ trả lời");
        }
        throw error;
      }
      io.to(rejectedCall.peerSocketId).emit("callRejected", {
        callId,
        name: user.name,
        profilepic: user.avatar,
      });
      socket.to(userId).emit("callEnded", { callId, by: userId });
      if (typeof acknowledgement === "function") acknowledgement({ success: true, callId });
    }, (error, args) => returnCallSocketError(socket, "reject-call", error, args));

    registerAsyncSocketHandler(socket, "end-call", async (data, acknowledgement) => {
      const callId = validateCallAction(data);
      await enforceSocketRateLimit("callAction", userId);
      let endedCall;
      try {
        endedCall = await endCall({
          callId,
          actorId: userId,
          actorSocketId: socket.id,
        });
      } catch (error) {
        if (error instanceof CallStateError) {
          if (error.code === "CALL_ACTION_DENIED") {
            throw new CallSignalingError(403, "CALL_END_DENIED", "Không có quyền kết thúc cuộc gọi này");
          }
          throw new CallSignalingError(409, "CALL_ALREADY_ENDED", "Cuộc gọi đã kết thúc");
        }
        throw error;
      }

      const peerTarget = endedCall.peerSocketId || endedCall.peerUserId;
      io.to(peerTarget).emit("callEnded", { callId, by: userId });
      socket.to(userId).emit("callEnded", { callId, by: userId });
      if (typeof acknowledgement === "function") acknowledgement({ success: true, callId });
    }, (error, args) => returnCallSocketError(socket, "end-call", error, args));
    //disconnect
    registerAsyncSocketHandler(socket, "disconnect", async () => {
      clearInterval(presenceHeartbeat);
      let distributedSocketCountAfterDisconnect = null;
      try {
        distributedSocketCountAfterDisconnect = await removePresence({
          userId,
          socketId: socket.id,
        });
      } catch (error) {
        console.error("Socket presence removal failed", {
          socketId: socket.id,
          userId,
          error,
        });
      }

      try {
        const terminatedCalls = await cleanupCallsForSocket({
          userId,
          socketId: socket.id,
        });
        for (const terminatedCall of terminatedCalls) {
          const peerTarget =
            terminatedCall.peerSocketId || terminatedCall.peerUserId;
          io.to(peerTarget).emit("callEnded", {
            callId: terminatedCall.callId,
            by: userId,
          });
        }
      } catch (error) {
        console.error("Distributed call cleanup failed", {
          socketId: socket.id,
          userId,
          error,
        });
      }

      const sockets = onlineUser.get(userId);
      sockets?.delete(socket.id);
      if (sockets?.size === 0) {
        onlineUser.delete(userId);
      }
      if (distributedSocketCountAfterDisconnect === 0) {
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
