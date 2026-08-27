const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const multer = require("multer");
const {
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_MAX_COUNT,
  PROFILE_IMAGE_MAX_BYTES,
  mapUploadError,
} = require("../middleware/uploadLimits.middleware");

test("uses bounded memory limits for profile images and chat files", () => {
  assert.equal(PROFILE_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(CHAT_FILE_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(CHAT_FILE_MAX_COUNT, 5);
});

test("maps Multer size and count failures to stable client errors", () => {
  const tooLarge = mapUploadError(new multer.MulterError("LIMIT_FILE_SIZE"));
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, "LIMIT_FILE_SIZE");
  const tooMany = mapUploadError(new multer.MulterError("LIMIT_FILE_COUNT"));
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.code, "LIMIT_FILE_COUNT");
  assert.equal(mapUploadError(new Error("internal")), null);
});

test("auth and room authorization run before upload allocation", () => {
  const root = path.resolve(__dirname, "..");
  const userRouter = fs.readFileSync(path.join(root, "router", "user.router.js"), "utf8");
  const chatRouter = fs.readFileSync(path.join(root, "router", "chat.router.js"), "utf8");
  assert.match(
    userRouter,
    /"\/updateImage",\s*middleware\.auth,\s*restRateLimit\("profileUpload"\),\s*profileImageUpload,/,
  );
  assert.match(
    chatRouter,
    /"\/:roomChatId",\s*middlewareChat\.isAccess,\s*restRateLimit\("chatUpload"\),\s*chatFileUpload,/,
  );
});
