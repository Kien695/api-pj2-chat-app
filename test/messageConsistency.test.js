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
  assert.match(source, /deliveryStatus: socket\.connected \? "pending" : "queued"/);
  assert.match(source, /delivered \? "sent" : "failed"/);
  assert.match(source, /item\.clientMessageId === formatted\.clientMessageId/);
});

test("frontend retries a bounded message outbox with stable client message ids", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );

  assert.match(source, /const MAX_MESSAGE_OUTBOX_SIZE = 100/);
  assert.match(source, /messageOutboxRef\.current\.set\(clientMessageId, entry\)/);
  assert.match(source, /payload: \{ \.\.\.payload, clientMessageId \}/);
  assert.match(source, /socket\.timeout\(MESSAGE_ACK_TIMEOUT_MS\)\.emit/);
  assert.match(source, /socket\.on\("connect", flushMessageOutbox\)/);
  assert.match(source, /socket\.on\("disconnect", queueInFlightMessages\)/);
  assert.match(source, /entry\.attempt \+= 1/);
  assert.match(source, /item\.deliveryStatus === "queued"/);
});

test("frontend scrolls new messages without interrupting history reading", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );
  assert.match(source, /isNearBottomRef/);
  assert.match(source, /distanceFromBottom < 120/);
  assert.match(source, /setNewMessageCount\(\(count\) => count \+ 1\)/);
  assert.match(source, /Có tin nhắn mới/);
  assert.match(source, /senderId === state\._id \|\| isNearBottomRef\.current/);
  assert.match(source, /pendingScrollRestoreRef/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /onLoad=\{handleMessageMediaLoad\}/);
});

test("frontend acknowledges and renders server-owned delivery receipts", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );

  assert.match(source, /"CLIENT_MESSAGE_DELIVERED"/);
  assert.match(source, /socket\.on\("SERVER_MESSAGE_RECEIPT", handleMessageReceipt\)/);
  assert.match(source, /socket\.off\("SERVER_MESSAGE_RECEIPT", handleMessageReceipt\)/);
  assert.match(source, /deliveryStatus: "delivered"/);
  assert.match(source, /item\.deliveryStatus === "delivered"/);
});

test("frontend reads only from chat detail with a server message boundary", () => {
  const detailSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );
  const sidebarSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Components/SidebarInfo/index.jsx"),
    "utf8",
  );

  assert.match(detailSource, /socket\.emit\("CLIENT_READ_ROOM", \{/);
  assert.match(detailSource, /messageId: latestIncomingMessage\._id/);
  assert.match(detailSource, /document\.visibilityState === "visible"/);
  assert.match(detailSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(detailSource, /deliveryStatus: "read"/);
  assert.match(detailSource, /item\.deliveryStatus === "read"/);
  assert.doesNotMatch(sidebarSource, /socket\.emit\("CLIENT_READ_ROOM"/);
});

test("chat history hydrates persisted delivery checkpoints", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../controller/chat.controller.js"),
    "utf8",
  );
  assert.match(source, /hydrateDeliveredReceipts\(\{/);
  assert.match(source, /senderUserId: userId/);
  const receiptSource = fs.readFileSync(
    path.join(__dirname, "../service/messageReceipt.service.js"),
    "utf8",
  );
  assert.match(receiptSource, /lastReadMessageId lastReadMessageCreatedAt/);
  assert.match(receiptSource, /readBy\.length > 0/);
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
  const unfriendHandler = appSource.slice(
    appSource.indexOf("const handleUnfriend"),
    appSource.indexOf("const handleAcceptfriend"),
  );
  assert.doesNotMatch(unfriendHandler, /fetchData\(\)/);
  assert.match(userSliceSource, /state\.countFriend = Math\.max/);
});

test("frontend has one socket owner and rejoins the active room after reconnect", () => {
  const layoutSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Layout/index.jsx"),
    "utf8",
  );

  assert.doesNotMatch(layoutSource, /socket\.connect\(\)/);
  assert.doesNotMatch(layoutSource, /socket\.disconnect\(\)/);
  assert.match(layoutSource, /socket\.on\("connect", joinActiveRoom\)/);
  assert.match(layoutSource, /socket\.off\("connect", joinActiveRoom\)/);
  assert.match(layoutSource, /socket\.connected/);
  assert.match(layoutSource, /socket\.emit\("JOIN_ROOM", \{ roomChatId \}\)/);
});

test("frontend catches up missed messages with an opaque server cursor", () => {
  const detailSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );
  const mergeSource = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/utils/mergeMessagePages.js"),
    "utf8",
  );
  const socketSource = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );

  assert.match(detailSource, /syncCursorRef\.current = res\.pagination\?\.syncCursor/);
  assert.match(detailSource, /\/sync\?limit=50&cursor=/);
  assert.match(detailSource, /page < 20/);
  assert.match(detailSource, /socket\.on\("connect", syncMissedMessages\)/);
  assert.match(detailSource, /socket\.off\("connect", syncMissedMessages\)/);
  assert.match(detailSource, /appendUniqueMessages\(current, response\.data\)/);
  assert.match(mergeSource, /current\.clientMessageId === message\.clientMessageId/);
  assert.match(socketSource, /syncCursor: encodeMessageCursor\(persisted\.message\)/);
});

test("sidebar reconciles an authoritative room snapshot after reconnect", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Components/SidebarInfo/index.jsx"),
    "utf8",
  );

  assert.match(source, /roomSyncInFlightRef/);
  assert.match(source, /getData\("\/auth\/getAllRoomChat"\)/);
  assert.match(source, /setRooms\(response\.data\)/);
  assert.match(source, /socket\.on\("connect", fetchRoomChat\)/);
  assert.match(source, /socket\.off\("connect", fetchRoomChat\)/);
  assert.match(source, /navigate\("\/chat"\)/);
});

test("app reconciles account state once after a real reconnect", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/App.jsx"),
    "utf8",
  );

  assert.match(source, /accountSyncInFlightRef/);
  assert.match(source, /reconnectPendingRef\.current = true/);
  assert.match(source, /socket\.on\("disconnect", handleDisconnect\)/);
  assert.match(source, /socket\.on\("connect", handleConnect\)/);
  assert.match(source, /socket\.off\("disconnect", handleDisconnect\)/);
  assert.match(source, /socket\.off\("connect", handleConnect\)/);
  assert.match(source, /socket\.off\("SERVER_RETURN_LIST_FRIEND", handleAcceptfriend\)/);
  assert.match(source, /getData\("\/auth\/friendList"\)/);
  assert.match(source, /getData\("\/auth\/getAcceptFriend"\)/);
  assert.match(source, /getData\("\/auth\/getRoom"\)/);
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
