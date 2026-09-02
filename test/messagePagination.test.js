const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  MessagePaginationError,
  decodeMessageCursor,
  encodeMessageCursor,
  getMessagePage,
  normalizeMessagePageSize,
} = require("../service/messagePagination.service");

const ids = {
  room: "507f191e810c19729de860ea",
  first: "507f191e810c19729de860e1",
  second: "507f191e810c19729de860e2",
  third: "507f191e810c19729de860e3",
};

test("normalizes bounded message page sizes", () => {
  assert.equal(normalizeMessagePageSize(), 30);
  assert.equal(normalizeMessagePageSize("1"), 1);
  assert.equal(normalizeMessagePageSize(50), 50);

  for (const value of [0, 51, -1, "1.5", "10x", [], { $gt: 1 }]) {
    assert.throws(
      () => normalizeMessagePageSize(value),
      (error) =>
        error instanceof MessagePaginationError &&
        error.code === "INVALID_MESSAGE_LIMIT",
    );
  }
});

test("round-trips an opaque cursor and rejects malformed cursor input", () => {
  const cursor = encodeMessageCursor({
    _id: ids.first,
    createdAt: new Date("2026-01-02T03:04:05.000Z"),
  });
  const boundary = decodeMessageCursor(cursor);

  assert.equal(boundary.id.toString(), ids.first);
  assert.equal(boundary.createdAt.toISOString(), "2026-01-02T03:04:05.000Z");
  assert.equal(cursor.includes(ids.first), false);

  for (const value of ["", "not+base64", "e30", "a".repeat(513)]) {
    assert.throws(
      () => decodeMessageCursor(value),
      (error) =>
        error instanceof MessagePaginationError &&
        error.code === "INVALID_MESSAGE_CURSOR",
    );
  }
});

test("queries one extra row and returns messages from oldest to newest", async () => {
  const calls = {};
  const rows = [
    { _id: ids.third, createdAt: new Date("2026-01-03T00:00:00.000Z") },
    { _id: ids.second, createdAt: new Date("2026-01-02T00:00:00.000Z") },
    { _id: ids.first, createdAt: new Date("2026-01-01T00:00:00.000Z") },
  ];
  const query = {
    sort(value) {
      calls.sort = value;
      return this;
    },
    limit(value) {
      calls.limit = value;
      return this;
    },
    populate(value) {
      (calls.populate ||= []).push(value);
      return calls.populate.length === 2 ? Promise.resolve(rows) : this;
    },
  };
  const chatModel = {
    find(filter) {
      calls.filter = filter;
      return query;
    },
  };

  const page = await getMessagePage({
    roomId: ids.room,
    limit: 2,
    chatModel,
  });

  assert.equal(calls.filter.room_chat_id.toString(), ids.room);
  assert.deepEqual(calls.sort, { createdAt: -1, _id: -1 });
  assert.equal(calls.limit, 3);
  assert.equal(calls.populate.length, 2);
  assert.deepEqual(
    page.messages.map((message) => message._id),
    [ids.second, ids.third],
  );
  assert.equal(page.pagination.hasMore, true);
  assert.equal(page.pagination.limit, 2);
  assert.ok(page.pagination.nextCursor);
  assert.equal(
    decodeMessageCursor(page.pagination.nextCursor).id.toString(),
    ids.second,
  );
});

test("applies both cursor tie-break conditions to the room query", async () => {
  const createdAt = new Date("2026-01-02T00:00:00.000Z");
  const cursor = encodeMessageCursor({ _id: ids.second, createdAt });
  let filter;
  const query = {
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    populate() {
      if (this.populated) return Promise.resolve([]);
      this.populated = true;
      return this;
    },
  };

  await getMessagePage({
    roomId: ids.room,
    cursor,
    chatModel: {
      find(value) {
        filter = value;
        return query;
      },
    },
  });

  assert.equal(filter.room_chat_id.toString(), ids.room);
  assert.equal(filter.$or[0].createdAt.$lt.toISOString(), createdAt.toISOString());
  assert.equal(filter.$or[1].createdAt.toISOString(), createdAt.toISOString());
  assert.equal(filter.$or[1]._id.$lt.toString(), ids.second);
});

test("chat API always enforces bounded pagination", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../controller/chat.controller.js"),
    "utf8",
  );
  const indexHandler = source.slice(
    source.indexOf("module.exports.index"),
    source.indexOf("module.exports.create"),
  );

  assert.match(indexHandler, /await getMessagePage\(/);
  assert.match(indexHandler, /cursor: req\.query\.cursor/);
  assert.match(indexHandler, /limit: req\.query\.limit/);
  assert.match(indexHandler, /pagination,/);
  assert.doesNotMatch(indexHandler, /\bChat\.find/);
  assert.doesNotMatch(indexHandler, /paginationRequested|Backward compatibility/);
  assert.match(indexHandler, /error instanceof MessagePaginationError/);
  assert.match(source, /module\.exports\.create = async/);
  assert.match(source, /Rejected chat upload cleanup failed/);
});
