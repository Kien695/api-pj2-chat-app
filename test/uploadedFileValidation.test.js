const assert = require("node:assert/strict");
const test = require("node:test");
const {
  validateChatFile,
  validateFileName,
  validateProfileImage,
} = require("../service/uploadedFileValidation.service");

const file = (originalname, mimetype, buffer) => ({ originalname, mimetype, buffer });

test("accepts profile images only when magic bytes, MIME and extension agree", () => {
  const jpeg = file("avatar.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
  assert.equal(validateProfileImage(jpeg).verifiedMime, "image/jpeg");
  assert.throws(
    () => validateProfileImage(file("avatar.png", "image/png", jpeg.buffer)),
    (error) => error.code === "FILE_TYPE_MISMATCH",
  );
  assert.throws(
    () => validateProfileImage(file("avatar.svg", "image/svg+xml", Buffer.from("<svg/>"))),
    (error) => error.code === "UNSUPPORTED_IMAGE_TYPE",
  );
});

test("accepts verified PDF, text, JSON and Office Open XML chat files", () => {
  assert.equal(validateChatFile(file("report.pdf", "application/pdf", Buffer.from("%PDF-1.7"))).verifiedMime,
    "application/pdf");
  assert.equal(validateChatFile(file("notes.txt", "text/plain", Buffer.from("safe text"))).verifiedMime,
    "text/plain");
  assert.equal(validateChatFile(file("data.json", "application/json", Buffer.from('{"safe":true}'))).verifiedMime,
    "application/json");
  const docx = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from("[Content_Types].xml word/document.xml"),
  ]);
  assert.equal(validateChatFile(file(
    "document.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docx,
  )).verifiedMime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

test("rejects executables, arbitrary ZIP files and MIME spoofing", () => {
  assert.throws(() => validateChatFile(file(
    "invoice.pdf",
    "application/pdf",
    Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
  )), (error) => error.code === "UNSUPPORTED_FILE_TYPE");
  assert.throws(() => validateChatFile(file(
    "archive.zip",
    "application/zip",
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  )), (error) => error.code === "UNSUPPORTED_FILE_TYPE");
  assert.throws(() => validateChatFile(file(
    "photo.jpg",
    "application/octet-stream",
    Buffer.from([0xff, 0xd8, 0xff]),
  )), (error) => error.code === "FILE_TYPE_MISMATCH");
});

test("rejects path-like, control-character and oversized filenames", () => {
  for (const name of ["../secret.pdf", "folder\\secret.pdf", "bad\0name.pdf", "a".repeat(256)]) {
    assert.throws(() => validateFileName(name),
      (error) => error.code === "UNSAFE_FILE_NAME");
  }
});
