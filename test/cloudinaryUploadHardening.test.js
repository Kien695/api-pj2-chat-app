const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  IMAGE_UPLOAD_OPTIONS,
  RAW_UPLOAD_OPTIONS,
} = require("../middleware/uploadCloud.middleware");
const {
  requireProfileImageUpload,
} = require("../middleware/validateUpload.middleware");

test("Cloudinary uses non-overwriting generated identifiers and explicit resource types", () => {
  assert.deepEqual(IMAGE_UPLOAD_OPTIONS, {
    resource_type: "image",
    folder: "chat/images",
    use_filename: false,
    unique_filename: true,
    overwrite: false,
  });
  assert.deepEqual(RAW_UPLOAD_OPTIONS, {
    resource_type: "raw",
    folder: "chat/files",
    use_filename: false,
    unique_filename: true,
    overwrite: false,
  });
});

test("profile image update rejects a request without an image", () => {
  let statusCode;
  let body;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; },
  };
  requireProfileImageUpload({}, res, () => assert.fail("must not continue"));
  assert.equal(statusCode, 400);
  assert.equal(body.code, "IMAGE_REQUIRED");
});

test("provider failures return stable errors without serializing provider details", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "middleware", "uploadCloud.middleware.js"),
    "utf8",
  );
  assert.match(source, /IMAGE_UPLOAD_PROVIDER_FAILED/);
  assert.match(source, /FILE_UPLOAD_PROVIDER_FAILED/);
  assert.match(source, /runWithConcurrency\(/);
  assert.match(source, /CLOUDINARY_UPLOAD_CONCURRENCY/);
  assert.match(source, /module\.exports\.uploadImages/);
  assert.match(source, /Partial image upload cleanup failed/);
  assert.doesNotMatch(source, /json\(\{\s*message:\s*"Upload failed",\s*error/);
});
