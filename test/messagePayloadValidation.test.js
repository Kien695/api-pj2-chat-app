const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateMessagePayload,
} = require("../service/messagePayloadValidation.service");

test("accepts and normalizes a non-empty text message", () => {
  assert.deepEqual(
    validateMessagePayload({
      message: "  hello  ",
      images: "",
      file: "",
      type: "text",
    }),
    { message: "hello", images: [], files: [], type: "text" },
  );
});

test("rejects empty and whitespace-only messages", () => {
  assert.throws(
    () =>
      validateMessagePayload({
        message: "   ",
        images: [],
        file: [],
        type: "text",
      }),
    (error) => error.code === "INVALID_MESSAGE_PAYLOAD",
  );
});

test("requires content matching the declared message type", () => {
  assert.throws(
    () =>
      validateMessagePayload({
        message: "not a file",
        images: [],
        file: [],
        type: "file",
      }),
    /không được để trống/,
  );
  assert.throws(
    () =>
      validateMessagePayload({
        message: "",
        images: [],
        file: [],
        type: "emoji",
      }),
  );
});

test("rejects client attempts to create system messages", () => {
  assert.throws(
    () =>
      validateMessagePayload({
        message: "fake system event",
        images: [],
        file: [],
        type: "system",
      }),
    (error) => error.code === "INVALID_MESSAGE_PAYLOAD",
  );
});

test("rejects oversized or malformed image and file collections", () => {
  assert.throws(() =>
    validateMessagePayload({
      message: "",
      images: Array(6).fill("data:image/png;base64,a"),
      file: [],
      type: "image",
    }),
  );
  assert.throws(() =>
    validateMessagePayload({
      message: "",
      images: [],
      file: [{ url: "https://file", public_id: "" }],
      type: "file",
    }),
  );
});

test("accepts uploaded files only with a cleanup lease id", () => {
  const cleanupJobId = "507f1f77bcf86cd799439011";
  const result = validateMessagePayload({
    message: "",
    images: [],
    file: [
      {
        url: "https://cdn.example/file",
        public_id: "chat/files/file-1",
        cleanup_job_id: cleanupJobId,
      },
    ],
    type: "file",
  });

  assert.equal(result.files[0].cleanup_job_id, cleanupJobId);
});

test("accepts uploaded image metadata and rejects Base64 image transport", () => {
  const image = {
    url: "https://cdn.example/image.webp",
    public_id: "chat/images/image-1",
    cleanup_job_id: "507f1f77bcf86cd799439011",
  };
  const result = validateMessagePayload({
    message: "",
    images: [image],
    file: [],
    type: "text",
  });

  assert.deepEqual(result.images, [image]);
  assert.throws(() =>
    validateMessagePayload({
      message: "",
      images: ["data:image/png;base64,a"],
      file: [],
      type: "image",
    }),
  );
});
