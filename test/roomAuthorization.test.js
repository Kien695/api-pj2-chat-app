const assert = require("node:assert/strict");
const { afterEach, describe, test } = require("node:test");
const mongoose = require("mongoose");

const Chat = require("../model/chat.model");
const RoomChat = require("../model/room-chat.model");
const authMiddleware = require("../middleware/auth.middleware");
const chatMiddleware = require("../middleware/chat.middleware");
const uploadCloudMiddleware = require("../middleware/uploadCloud.middleware");
const chatRouter = require("../router/chat.router");
const userRouter = require("../router/user.router");
const {
  requireGroupAdmin,
  requireMessageOwner,
  requireRoomMember,
} = require("../service/roomAuthorization.service");

const originalFindRoomById = RoomChat.findById;
const originalFindMessage = Chat.findOne;

afterEach(() => {
  RoomChat.findById = originalFindRoomById;
  Chat.findOne = originalFindMessage;
});

const ids = {
  admin: new mongoose.Types.ObjectId().toString(),
  member: new mongoose.Types.ObjectId().toString(),
  outsider: new mongoose.Types.ObjectId().toString(),
  room: new mongoose.Types.ObjectId().toString(),
  message: new mongoose.Types.ObjectId().toString(),
};

const groupRoom = {
  _id: ids.room,
  typeRoom: "group",
  users: [
    { user_id: ids.admin, role: "admin" },
    { user_id: ids.member, role: "member" },
  ],
};

const getRouteHandlers = (router, path, method) => {
  const layer = router.stack.find(
    (item) => item.route?.path === path && item.route.methods[method],
  );
  assert(layer, `Missing ${method.toUpperCase()} ${path}`);
  return layer.route.stack.map((item) => item.handle);
};

describe("room authorization policy", () => {
  test("rejects a malformed room id before querying MongoDB", async () => {
    let queried = false;
    RoomChat.findById = async () => {
      queried = true;
    };

    await assert.rejects(
      requireRoomMember("not-an-object-id", ids.member),
      (error) => error.status === 400 && error.code === "INVALID_ROOM_ID",
    );
    assert.equal(queried, false);
  });

  test("returns 404 when the room does not exist", async () => {
    RoomChat.findById = async () => null;

    await assert.rejects(
      requireRoomMember(ids.room, ids.member),
      (error) => error.status === 404 && error.code === "ROOM_NOT_FOUND",
    );
  });

  test("allows a room member and rejects an outsider", async () => {
    RoomChat.findById = async () => groupRoom;

    const access = await requireRoomMember(ids.room, ids.member);
    assert.equal(access.member.role, "member");
    await assert.rejects(
      requireRoomMember(ids.room, ids.outsider),
      (error) => error.status === 403 && error.code === "ROOM_ACCESS_DENIED",
    );
  });

  test("allows only an admin of a group room", async () => {
    RoomChat.findById = async () => groupRoom;

    const access = await requireGroupAdmin(ids.room, ids.admin);
    assert.equal(access.member.role, "admin");
    await assert.rejects(
      requireGroupAdmin(ids.room, ids.member),
      (error) => error.status === 403 && error.code === "ROOM_ADMIN_REQUIRED",
    );
  });

  test("does not treat superAdmin in a friend room as group admin", async () => {
    RoomChat.findById = async () => ({
      typeRoom: "friend",
      users: [{ user_id: ids.admin, role: "superAdmin" }],
    });

    await assert.rejects(
      requireGroupAdmin(ids.room, ids.admin),
      (error) => error.status === 403 && error.code === "ROOM_ADMIN_REQUIRED",
    );
  });

  test("requires message owner, room, and actor to match", async () => {
    RoomChat.findById = async () => groupRoom;
    const message = {
      _id: ids.message,
      room_chat_id: ids.room,
      user_id: ids.member,
    };
    let query;
    Chat.findOne = async (filter) => {
      query = filter;
      return message;
    };

    const result = await requireMessageOwner(
      ids.message,
      ids.room,
      ids.member,
    );
    assert.equal(result, message);
    assert.deepEqual(query, {
      _id: ids.message,
      room_chat_id: ids.room,
      user_id: ids.member,
    });
  });

  test("rejects a message that does not match owner and room", async () => {
    RoomChat.findById = async () => groupRoom;
    Chat.findOne = async () => null;

    await assert.rejects(
      requireMessageOwner(ids.message, ids.room, ids.member),
      (error) =>
        error.status === 403 && error.code === "MESSAGE_ACCESS_DENIED",
    );
  });
});

describe("room REST authorization ordering", () => {
  test("authorizes chat upload before Multer and Cloudinary", () => {
    const handlers = getRouteHandlers(chatRouter, "/:roomChatId", "post");

    assert.equal(handlers[0], chatMiddleware.isAccess);
    assert.equal(handlers[1].name, "multerMiddleware");
    assert.equal(handlers[2], uploadCloudMiddleware.uploadFile);
  });

  test("authenticates and authorizes room edit before upload", () => {
    const handlers = getRouteHandlers(userRouter, "/editRoom/:id", "patch");

    assert.equal(handlers[0], authMiddleware.auth);
    assert.equal(handlers[1], chatMiddleware.isGroupAdmin);
    assert.equal(handlers[2].name, "multerMiddleware");
    assert.equal(handlers[3], uploadCloudMiddleware.uploadOne);
  });

  test("applies the expected policy to every room mutation route", () => {
    const addMember = getRouteHandlers(userRouter, "/addMember/:id", "patch");
    const removeMember = getRouteHandlers(
      userRouter,
      "/removeMember/:id",
      "patch",
    );
    const leaveGroup = getRouteHandlers(userRouter, "/leaveGroup/:id", "patch");
    const removeRoom = getRouteHandlers(
      userRouter,
      "/removeRoom/:roomChatId",
      "delete",
    );

    assert.deepEqual(addMember.slice(0, 2), [
      authMiddleware.auth,
      chatMiddleware.isGroupAdmin,
    ]);
    assert.deepEqual(removeMember.slice(0, 2), [
      authMiddleware.auth,
      chatMiddleware.isGroupAdmin,
    ]);
    assert.deepEqual(leaveGroup.slice(0, 2), [
      authMiddleware.auth,
      chatMiddleware.isAccess,
    ]);
    assert.deepEqual(removeRoom.slice(0, 2), [
      authMiddleware.auth,
      chatMiddleware.isGroupAdmin,
    ]);
  });
});
