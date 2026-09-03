const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MessageSearchError,
  escapeRegex,
  getMessageContext,
  normalizeSearchLimit,
  searchRoomMessages,
} = require("../service/messageSearch.service");

const roomId = "507f191e810c19729de860ea";
const messageId = "507f191e810c19729de860e1";

const queryReturning = (rows, calls = {}) => ({
  select(value) { calls.select = value; return this; },
  sort(value) { calls.sort = value; return this; },
  limit(value) { calls.limit = value; return this; },
  populate(value) {
    (calls.populate ||= []).push(value);
    return calls.populate.length % 2 === 0 ? Promise.resolve(rows) : this;
  },
});

test("escapes search syntax and enforces bounded result limits", () => {
  assert.equal(escapeRegex("xin.*[chào]"), "xin\\.\\*\\[chào\\]");
  assert.equal(normalizeSearchLimit(), 20);
  assert.equal(normalizeSearchLimit("30"), 30);
  for (const value of [0, 31, "1.5", { $gt: 1 }]) {
    assert.throws(() => normalizeSearchLimit(value), MessageSearchError);
  }
});

test("searches only visible messages in one room with stable pagination", async () => {
  const rows = [
    { _id: messageId, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    { _id: "507f191e810c19729de860e2", createdAt: new Date("2026-01-01T00:00:00.000Z") },
  ];
  const calls = {};
  const model = {
    find(filter) { calls.filter = filter; return queryReturning(rows, calls); },
    async countDocuments(filter) { calls.countFilter = filter; return 7; },
  };
  const result = await searchRoomMessages({
    roomId,
    keyword: "  Chào.*  ".trim(),
    limit: 1,
    chatModel: model,
  });

  assert.equal(calls.filter.room_chat_id.toString(), roomId);
  assert.deepEqual(calls.filter.deleted, { $ne: true });
  assert.deepEqual(calls.filter.type, { $ne: "system" });
  assert.equal(calls.filter.content.$regex, "Chào\\.\\*");
  assert.equal(calls.filter.content.$options, "i");
  assert.deepEqual(calls.sort, { createdAt: -1, _id: -1 });
  assert.equal(calls.limit, 2);
  assert.deepEqual(calls.countFilter, {
    room_chat_id: calls.filter.room_chat_id,
    deleted: { $ne: true },
    type: { $ne: "system" },
    content: calls.filter.content,
  });
  assert.equal(result.messages.length, 1);
  assert.equal(result.total, 7);
  assert.equal(result.pagination.hasMore, true);
  assert.ok(result.pagination.nextCursor);
});

test("returns a bounded chronological context around an authorized target", async () => {
  const target = { _id: messageId, createdAt: new Date("2026-01-02T00:00:00.000Z") };
  const findOneCalls = {};
  const findFilters = [];
  const model = {
    findOne(filter) { findOneCalls.filter = filter; return queryReturning(target, findOneCalls); },
    find(filter) {
      findFilters.push(filter);
      const rows = findFilters.length === 1
        ? [{ _id: "older-2" }, { _id: "older-1" }]
        : [{ _id: "newer-1" }];
      return queryReturning(rows, {});
    },
  };
  const result = await getMessageContext({ roomId, messageId, chatModel: model });
  assert.equal(findOneCalls.filter.room_chat_id.toString(), roomId);
  assert.deepEqual(findOneCalls.filter.deleted, { $ne: true });
  assert.deepEqual(result.messages.map((item) => item._id), ["older-1", "older-2", messageId, "newer-1"]);
  assert.equal(result.targetMessageId, messageId);
  assert.equal(findFilters.every((filter) => filter.deleted.$ne === true), true);
});

test("message search routes authorize membership before querying", () => {
  const source = fs.readFileSync(path.join(__dirname, "../router/chat.router.js"), "utf8");
  assert.match(
    source,
    /"\/:roomChatId\/search",\s*middlewareChat\.isAccess,\s*restRateLimit\("messageSearch"\),\s*validateMessageSearch,\s*controller\.search/,
  );
  assert.match(
    source,
    /"\/:roomChatId\/messages\/:messageId\/context",\s*middlewareChat\.isAccess,\s*restRateLimit\("messageSearch"\),\s*controller\.context/,
  );
});

test("frontend debounces search and opens a server-authorized message context", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Components/MessageSearchPanel/index.jsx"),
    "utf8",
  );
  const chatDetail = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Page/ChatDetail/index.jsx"),
    "utf8",
  );
  assert.match(panel, /const DEBOUNCE_MS = 350/);
  assert.match(panel, /normalized\.length < 2/);
  assert.match(panel, /requestSequenceRef/);
  assert.match(panel, /encodeURIComponent\(normalized\)/);
  assert.match(panel, /pagination\.nextCursor/);
  assert.match(panel, /Không có kết quả/);
  assert.match(chatDetail, /messages\/\$\{encodeURIComponent\(result\._id\)\}\/context/);
  assert.match(chatDetail, /data-message-id=\{item\._id\}/);
  assert.match(
    chatDetail,
    /renderHighlightedText\(\s*item\.content,\s*activeSearchKeyword,?\s*\)/,
  );
  assert.match(chatDetail, /chat-header-action !hidden md:!flex/);
  assert.match(chatDetail, /handleOpenMobileMessageSearch/);
  assert.match(chatDetail, /Tìm kiếm tin nhắn/);
  assert.doesNotMatch(panel + chatDetail, /dangerouslySetInnerHTML/);
});
