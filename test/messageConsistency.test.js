const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const Chat = require("../model/chat.model");

test("chat schema has a scoped unique idempotency index", () => {
  const index = Chat.schema.indexes().find(
    ([fields]) =>
      fields.user_id === 1 &&
      fields.room_chat_id === 1 &&
      fields.clientMessageId === 1,
  );

  assert.ok(index);
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, {
    clientMessageId: { $type: "string" },
  });
});

test("chat schema has an index for stable room history pagination", () => {
  const index = Chat.schema.indexes().find(
    ([fields, options]) =>
      options.name === "room_chat_id_1_createdAt_-1__id_-1" &&
      fields.room_chat_id === 1 &&
      fields.createdAt === -1 &&
      fields._id === -1,
  );

  assert.ok(index);
  assert.notEqual(index[1].unique, true);
});

test("message and room writes use the same MongoDB transaction", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/messagePersistence.service.js"),
    "utf8",
  );

  assert.match(source, /runMongoTransaction/);
  assert.match(source, /Chat\.create\([\s\S]*\{ session \}/);
  assert.match(source, /RoomChat\.findOneAndUpdate\([\s\S]*session/);
  assert.match(source, /error\?\.code !== 11000/);
});

test("room membership and its system message share a transaction", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/roomMembershipMutation.service.js"),
    "utf8",
  );

  assert.equal((source.match(/runMongoTransaction/g) || []).length, 4);
  assert.equal((source.match(/Chat\.create/g) || []).length, 3);
  assert.match(source, /findOneAndUpdate\([\s\S]*\{ new: true, session \}/);
});

test("frontend sends clientMessageId and reconciles optimistic messages", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );

  assert.match(source, /window\.crypto\.randomUUID\(\)/);
  assert.match(source, /deliveryStatus: "pending"/);
  assert.match(source, /deliveryStatus: delivered \? "sent" : "failed"/);
  assert.match(source, /item\.clientMessageId === formatted\.clientMessageId/);
});

test("chat images use REST metadata and never upload Base64 through Socket.IO", () => {
  const frontendSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );
  const socketSource = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );
  const cloudinarySource = fs.readFileSync(
    path.join(__dirname, "../service/cloudinaryAsset.service.js"),
    "utf8",
  );

  assert.match(frontendSource, /postData\(`\/chat\/\$\{roomChatId\}\/images`/);
  assert.doesNotMatch(frontendSource, /convertImagesToBase64/);
  assert.doesNotMatch(socketSource, /uploadImagesWithCompensation/);
  assert.doesNotMatch(cloudinarySource, /base64Images/);
  assert.match(socketSource, /IMAGE_SINGLE_ROOM_REQUIRED/);
});

test("frontend bootstrap does not refetch all user data on room changes", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/App.jsx"),
    "utf8",
  );
  const userSliceSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/redux/userSlice.js"),
    "utf8",
  );

  assert.match(appSource, /Promise\.allSettled/);
  assert.match(appSource, /\}, \[dispatch, isLogin\]\);/);
  assert.match(appSource, /currentRoomIdRef\.current === roomChatId/);
  assert.doesNotMatch(
    appSource,
    /handleUnfriend[\s\S]*?fetchData\(\)[\s\S]*?handleAcceptfriend/,
  );
  assert.match(userSliceSource, /state\.countFriend = Math\.max/);
});

test("friend suggestions load only while the add-friend dialog is open", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Components/AddFriend/index.jsx"),
    "utf8",
  );

  assert.match(source, /if \(!open\) return;/);
  assert.match(source, /getData\("\/auth\/getAllUser"\)/);
  assert.match(source, /\}, \[open\]\);/);
  assert.doesNotMatch(source, /getAllUser[`"\)]*[\s\S]{0,200}\[keyword\]/);
});

test("frontend user searches are debounced, encoded, and ignore stale responses", () => {
  const hookSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/hooks/useDebouncedValue.js"),
    "utf8",
  );
  const searchFiles = [
    "Components/Function/index.jsx",
    "Components/AddGroup/index.jsx",
    "Components/AddMember/index.jsx",
  ].map((relativePath) =>
    fs.readFileSync(
      path.join(__dirname, "../../chat-app/src", relativePath),
      "utf8",
    ),
  );
  const addFriendSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Components/AddFriend/index.jsx"),
    "utf8",
  );

  assert.match(hookSource, /setTimeout/);
  assert.match(hookSource, /clearTimeout/);
  searchFiles.forEach((source) => {
    assert.match(source, /useDebouncedValue/);
    assert.match(source, /encodeURIComponent\(debouncedKeyword\)/);
    assert.match(source, /let active = true/);
    assert.match(source, /active = false/);
  });
  assert.match(addFriendSource, /encodeURIComponent\(keyword\.trim\(\)\)/);
});

test("share-room data loads lazily only when its dialog opens", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );

  assert.match(source, /if \(!openInvite \|\| shareRoomsLoadedRef\.current\) return/);
  assert.match(source, /shareRoomsLoadedRef\.current = true/);
  assert.match(source, /\}, \[openInvite\]\);/);
  assert.match(source, /isLoadingShareRooms \?/);
});
