const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const cloudinary = require("cloudinary").v2;

const MediaCleanupJob = require("../model/media-cleanup-job.model");
const {
  createMediaCleanupScheduler,
} = require("../service/mediaCleanupJob.service");
const {
  CLOUDINARY_CLEANUP_CONCURRENCY,
  CLOUDINARY_UPLOAD_CONCURRENCY,
  cleanupAssets,
  runWithConcurrency,
} = require("../service/cloudinaryAsset.service");

test("bounds concurrent Cloudinary work and preserves result order", async () => {
  let active = 0;
  let maximumActive = 0;
  const { errors, results } = await runWithConcurrency(
    [1, 2, 3, 4, 5, 6],
    2,
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return value * 2;
    },
  );

  assert.equal(maximumActive, 2);
  assert.deepEqual(errors, []);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
  assert.equal(CLOUDINARY_UPLOAD_CONCURRENCY, 3);
  assert.equal(CLOUDINARY_CLEANUP_CONCURRENCY, 5);
});

test("media cleanup scheduler prevents overlap and waits during stop", async () => {
  let release;
  let scheduledRun;
  let runCalls = 0;
  let clearedTimer = false;
  const scheduler = createMediaCleanupScheduler({
    runDrain: async () => {
      runCalls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    logger: { error() {} },
    setIntervalImpl(callback) {
      scheduledRun = callback;
      return { unref() {} };
    },
    clearIntervalImpl() {
      clearedTimer = true;
    },
  });

  scheduler.start();
  await Promise.resolve();
  assert.equal(await scheduledRun(), false);
  assert.equal(runCalls, 1);
  release();
  await scheduler.stop();
  assert.equal(clearedTimer, true);
});

test("server awaits media cleanup before closing dependencies", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../index.js"),
    "utf8",
  );
  assert.match(source, /await stopMediaCleanupWorker\(\)/);
});

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
