const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const mongoose = require("mongoose");

const runMongoTransaction = require("../utils/mongoTransaction");
const { supportsTransactions } = require("../config/database");
const {
  groupAdminMutationFilter,
} = require("../service/roomMutationAuthorization.service");

test("transaction helper returns work result and always ends the session", async () => {
  const originalStartSession = mongoose.startSession;
  let ended = false;
  mongoose.startSession = async () => ({
    withTransaction: async (work) => work(),
    endSession: async () => { ended = true; },
  });

  try {
    const result = await runMongoTransaction(async (session) => {
      assert.ok(session);
      return "committed";
    });
    assert.equal(result, "committed");
    assert.equal(ended, true);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("transaction helper ends the session after rollback", async () => {
  const originalStartSession = mongoose.startSession;
  const expectedError = new Error("write conflict");
  let ended = false;
  mongoose.startSession = async () => ({
    withTransaction: async (work) => work(),
    endSession: async () => { ended = true; },
  });

  try {
    await assert.rejects(
      runMongoTransaction(async () => { throw expectedError; }),
      expectedError,
    );
    assert.equal(ended, true);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("group mutation filter requires current admin in the database write", () => {
  const filter = groupAdminMutationFilter("room-1", "admin-1", [
    { users: { $elemMatch: { user_id: "member-1" } } },
  ]);

  assert.equal(filter._id, "room-1");
  assert.equal(filter.typeRoom, "group");
  assert.deepEqual(filter.$and[0], {
    users: { $elemMatch: { user_id: "admin-1", role: "admin" } },
  });
  assert.equal(filter.$and.length, 2);
});

test("transaction capability requires sessions and replica set or mongos", () => {
  assert.equal(
    supportsTransactions({ logicalSessionTimeoutMinutes: 30, setName: "rs0" }),
    true,
  );
  assert.equal(
    supportsTransactions({ logicalSessionTimeoutMinutes: 30, msg: "isdbgrid" }),
    true,
  );
  assert.equal(supportsTransactions({ logicalSessionTimeoutMinutes: 30 }), false);
  assert.equal(supportsTransactions({ setName: "rs0" }), false);
});

test("friendship multi-document writes are session-bound", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/friendship.service.js"),
    "utf8",
  );

  assert.match(source, /runMongoTransaction/);
  assert.doesNotMatch(source, /\.save\(\)/);
  assert.match(source, /RoomChat\.create\([\s\S]*\{ session \}/);
  assert.match(source, /createRoomDeletionJob\(room, session\)/);
  assert.doesNotMatch(source, /Chat\.deleteMany/);
  assert.match(source, /RoomChat\.deleteOne\([\s\S]*\{ session \}/);
});
