const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("room edit and rename system message share one transaction", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/roomEdit.service.js"),
    "utf8",
  );

  assert.match(source, /runMongoTransaction/);
  assert.match(source, /RoomChat\.findOneAndUpdate\([\s\S]*session/);
  assert.match(source, /Chat\.create\([\s\S]*\{ session \}/);
  assert.match(source, /groupAdminMutationFilter\(roomId, actorId\)/);
});

test("room edit notification failure cannot change the committed API result", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../controller/user.controller.js"),
    "utf8",
  );
  const start = source.indexOf("module.exports.editRoomChat");
  const end = source.indexOf("module.exports.searchUser", start);
  const handler = source.slice(start, end);

  assert.match(handler, /const mutation = await editRoom/);
  assert.match(handler, /catch \(notificationError\)/);
  assert.ok(
    handler.indexOf("catch (notificationError)") <
      handler.indexOf("return res.status(200)"),
  );
  assert.doesNotMatch(handler, /systemMsg = await Chat\.create/);
});
