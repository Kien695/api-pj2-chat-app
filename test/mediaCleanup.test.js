const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const cloudinary = require("cloudinary").v2;

const MediaCleanupJob = require("../model/media-cleanup-job.model");
const {
  cleanupAssets,
  uploadImagesWithCompensation,
} = require("../service/cloudinaryAsset.service");

test("media cleanup attempts every asset and reports partial failure", async () => {
  const originalDestroy = cloudinary.uploader.destroy;
  const destroyed = [];
  cloudinary.uploader.destroy = async (publicId, options) => {
    destroyed.push({ publicId, resourceType: options.resource_type });
    if (publicId === "broken") throw new Error("cloud unavailable");
  };

  try {
    await assert.rejects(
      cleanupAssets([
        { public_id: "broken", resource_type: "image" },
        { public_id: "file-1", resource_type: "raw" },
      ]),
      AggregateError,
    );
    assert.deepEqual(destroyed, [
      { publicId: "broken", resourceType: "image" },
      { publicId: "file-1", resourceType: "raw" },
    ]);
  } finally {
    cloudinary.uploader.destroy = originalDestroy;
  }
});

test("partial image upload failure compensates successful uploads", async () => {
  const originalUpload = cloudinary.uploader.upload;
  const originalDestroy = cloudinary.uploader.destroy;
  const destroyed = [];
  cloudinary.uploader.upload = async (value) => {
    if (value === "bad-image") throw new Error("upload failed");
    return { secure_url: "https://asset/one", public_id: "image-1" };
  };
  cloudinary.uploader.destroy = async (publicId) => destroyed.push(publicId);

  try {
    await assert.rejects(
      uploadImagesWithCompensation(["good-image", "bad-image"]),
      /upload failed/,
    );
    assert.deepEqual(destroyed, ["image-1"]);
  } finally {
    cloudinary.uploader.upload = originalUpload;
    cloudinary.uploader.destroy = originalDestroy;
  }
});

test("cleanup jobs retain retry state durably", () => {
  assert.ok(MediaCleanupJob.schema.path("kind"));
  assert.ok(MediaCleanupJob.schema.path("roomId"));
  assert.ok(MediaCleanupJob.schema.path("ownerId"));
  assert.ok(MediaCleanupJob.schema.path("status"));
  assert.ok(MediaCleanupJob.schema.path("attempts"));
  assert.ok(MediaCleanupJob.schema.path("nextAttemptAt"));
  assert.ok(MediaCleanupJob.schema.path("lastError"));
});

test("uploaded files use a delayed cleanup lease cancelled by persistence", () => {
  const uploadSource = fs.readFileSync(
    path.join(__dirname, "../controller/chat.controller.js"),
    "utf8",
  );
  const leaseSource = fs.readFileSync(
    path.join(__dirname, "../service/uploadCleanupLease.service.js"),
    "utf8",
  );

  assert.match(uploadSource, /cleanup_job_id/);
  assert.match(uploadSource, /15 \* 60 \* 1000/);
  assert.match(leaseSource, /MediaCleanupJob\.deleteMany/);
  assert.match(leaseSource, /ownerId: userId/);
  assert.match(leaseSource, /assertCleanupLeaseMatchesFiles/);
});

test("room deletion and media cleanup job share a transaction", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/roomDeletion.service.js"),
    "utf8",
  );
  assert.match(source, /runMongoTransaction/);
  assert.match(source, /MediaCleanupJob\.create\([^;]+\{ session \}/s);
  assert.match(source, /RoomChat\.deleteOne\([^;]+\{ session \}/s);
  assert.doesNotMatch(source, /const Chat = require/);
  assert.match(source, /kind: "room-deletion"/);
});

test("room deletion worker reads and removes messages in bounded batches", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/mediaCleanupJob.service.js"),
    "utf8",
  );

  assert.match(source, /ROOM_MESSAGE_BATCH_SIZE = 100/);
  assert.match(source, /\.limit\(ROOM_MESSAGE_BATCH_SIZE\)/);
  assert.match(source, /Chat\.deleteMany\(\{ _id: \{ \$in:/);
  assert.doesNotMatch(source, /Chat\.find\(\{ room_chat_id:[^;]+\.lean\(\)/s);
});

test("unfriend delegates private chat history to the batch deletion worker", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../service/friendship.service.js"),
    "utf8",
  );

  assert.match(source, /createRoomDeletionJob\(room, session\)/);
  assert.doesNotMatch(source, /Chat\.deleteMany/);
  assert.match(source, /typeRoom: "friend"/);
});

test("REST file upload no longer persists a duplicate Chat", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../controller/chat.controller.js"),
    "utf8",
  );
  const createHandler = source.slice(source.indexOf("module.exports.create"));
  assert.doesNotMatch(createHandler, /new Chat/);
  assert.match(createHandler, /requireRoomMember/);
  assert.match(createHandler, /cleanupAssets/);
});
