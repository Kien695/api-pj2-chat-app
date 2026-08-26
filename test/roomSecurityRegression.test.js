const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, describe, test } = require("node:test");
const mongoose = require("mongoose");

const RoomChat = require("../model/room-chat.model");
const {
  RoomAuthorizationError,
  requireRoomMembers,
  sendRoomAuthorizationError,
} = require("../service/roomAuthorization.service");

const originalFindRoomById = RoomChat.findById;

afterEach(() => {
  RoomChat.findById = originalFindRoomById;
});

describe("room authorization security regressions", () => {
  test("rejects multi-room authorization when any target is unauthorized", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const allowedRoomId = new mongoose.Types.ObjectId().toString();
    const deniedRoomId = new mongoose.Types.ObjectId().toString();
    RoomChat.findById = async (roomId) => ({
      _id: roomId,
      typeRoom: "group",
      users:
        roomId === allowedRoomId
          ? [{ user_id: userId, role: "member" }]
          : [],
    });

    await assert.rejects(
      requireRoomMembers([allowedRoomId, deniedRoomId], userId),
      (error) => error.status === 403 && error.code === "ROOM_ACCESS_DENIED",
    );
  });

  test("returns a map only after all multi-room targets are authorized", async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const roomIds = [
      new mongoose.Types.ObjectId().toString(),
      new mongoose.Types.ObjectId().toString(),
    ];
    RoomChat.findById = async (roomId) => ({
      _id: roomId,
      typeRoom: "group",
      users: [{ user_id: userId, role: "member" }],
    });

    const rooms = await requireRoomMembers(roomIds, userId);
    assert.equal(rooms.size, 2);
    assert.equal(rooms.get(roomIds[0])._id, roomIds[0]);
    assert.equal(rooms.get(roomIds[1])._id, roomIds[1]);
  });

  test("maps authorization errors to stable HTTP status and code", () => {
    let statusCode;
    let body;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    };
    const handled = sendRoomAuthorizationError(
      res,
      new RoomAuthorizationError(
        403,
        "ROOM_ACCESS_DENIED",
        "Access denied",
      ),
    );

    assert.equal(handled, true);
    assert.equal(statusCode, 403);
    assert.deepEqual(body, {
      error: true,
      success: false,
      code: "ROOM_ACCESS_DENIED",
      message: "Access denied",
    });
  });

  test("does not treat unrelated internal errors as authorization errors", () => {
    assert.equal(sendRoomAuthorizationError({}, new Error("internal")), false);
  });
});

describe("trusted room mutation event regressions", () => {
  test("legacy client mutation events are absent from server and frontend", () => {
    const projectRoot = path.resolve(__dirname, "..", "..");
    const files = [
      path.join(projectRoot, "server-chat-api", "socket", "index.js"),
      path.join(projectRoot, "chat-app", "src", "Components", "AddGroup", "index.jsx"),
      path.join(projectRoot, "chat-app", "src", "Components", "AddMember", "index.jsx"),
      path.join(projectRoot, "chat-app", "src", "Page", "ChatDetail", "index.jsx"),
      path.join(projectRoot, "chat-app", "src", "Page", "ListGroup", "index.jsx"),
    ];
    const source = files
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    const legacyEvents = [
      "CLIENT_UPDATE_ROOM_INFO",
      "CLIENT_ADD_MEMBER",
      "CLIENT_REMOVE_MEMBER",
      "CLIENT_LEAVE_GROUP",
      "CLIENT_LEAVE_ROOM_PERSON",
      "CLIENT_REMOVE_ROOM",
      "CLIENT_CREATE_ROOM",
    ];

    legacyEvents.forEach((event) => assert.equal(source.includes(event), false));
  });

  test("room mutation notifications originate from the REST controller", () => {
    const controllerPath = path.resolve(
      __dirname,
      "..",
      "controller",
      "user.controller.js",
    );
    const source = fs.readFileSync(controllerPath, "utf8");
    const trustedEvents = [
      "SERVER_RETURN_NEW_ROOM",
      "SERVER_NEW_MESSAGE",
      "SERVER_ROOM_UPDATED",
      "SERVER_ROOM_UPDATED_USER",
      "SERVER_ROOM_REMOVE_USERS",
      "SERVER_LEAVE_ROOM_PERSON",
      "SERVER_RETURN_ROOM",
    ];

    trustedEvents.forEach((event) => assert.equal(source.includes(event), true));
    assert.equal(source.includes("socketsLeave(roomChatId)"), true);
  });
});
