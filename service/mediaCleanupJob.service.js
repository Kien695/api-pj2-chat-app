const MediaCleanupJob = require("../model/media-cleanup-job.model");
const Chat = require("../model/chat.model");
const { cleanupAssets } = require("./cloudinaryAsset.service");

const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const WORKER_INTERVAL_MS = 30 * 1000;
const ROOM_MESSAGE_BATCH_SIZE = 100;
let workerTimer;

const claimJob = () => {
  const now = new Date();
  return MediaCleanupJob.findOneAndUpdate(
    {
      $or: [
        { status: "pending", nextAttemptAt: { $lte: now } },
        {
          status: "processing",
          updatedAt: { $lte: new Date(now.getTime() - PROCESSING_TIMEOUT_MS) },
        },
      ],
    },
    { $set: { status: "processing" }, $inc: { attempts: 1 } },
    { new: true, sort: { nextAttemptAt: 1 } },
  );
};

const processNextMediaCleanupJob = async () => {
  const job = await claimJob();
  if (!job) return false;

  try {
    if (job.kind === "room-deletion") {
      const chats = await Chat.find({ room_chat_id: job.roomId })
        .select("images files")
        .sort({ _id: 1 })
        .limit(ROOM_MESSAGE_BATCH_SIZE);
      if (chats.length > 0) {
        const batchAssets = chats.flatMap((chat) => [
          ...chat.images
            .filter((image) => image.public_id)
            .map((image) => ({
              public_id: image.public_id,
              resource_type: "image",
            })),
          ...chat.files
            .filter((file) => file.public_id)
            .map((file) => ({
              public_id: file.public_id,
              resource_type: "raw",
            })),
        ]);
        await cleanupAssets(batchAssets);
        await Chat.deleteMany({ _id: { $in: chats.map((chat) => chat._id) } });
        await MediaCleanupJob.updateOne(
          { _id: job._id, status: "processing" },
          {
            $set: { status: "pending", nextAttemptAt: new Date() },
            $unset: { lastError: 1 },
          },
        );
      } else {
        await cleanupAssets(job.assets);
        await MediaCleanupJob.deleteOne({
          _id: job._id,
          status: "processing",
        });
      }
    } else {
      await cleanupAssets(job.assets);
      await MediaCleanupJob.deleteOne({ _id: job._id, status: "processing" });
    }
  } catch (error) {
    const retryDelay = Math.min(60 * 60 * 1000, 2 ** job.attempts * 1000);
    await MediaCleanupJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "pending",
          nextAttemptAt: new Date(Date.now() + retryDelay),
          lastError: error.message,
        },
      },
    );
    console.error("Media cleanup job failed", {
      jobId: job._id.toString(),
      attempts: job.attempts,
      error,
    });
  }
  return true;
};

const drainMediaCleanupJobs = async (limit = 10) => {
  for (let index = 0; index < limit; index += 1) {
    if (!(await processNextMediaCleanupJob())) break;
  }
};

const enqueueMediaCleanup = async (assets) => {
  if (!assets?.length) return;
  await MediaCleanupJob.create({ assets });
  drainMediaCleanupJobs().catch((error) => {
    console.error("Immediate media cleanup failed", error);
  });
};

const startMediaCleanupWorker = () => {
  if (workerTimer) return;
  drainMediaCleanupJobs().catch((error) => {
    console.error("Media cleanup worker failed", error);
  });
  workerTimer = setInterval(() => {
    drainMediaCleanupJobs().catch((error) => {
      console.error("Media cleanup worker failed", error);
    });
  }, WORKER_INTERVAL_MS);
  workerTimer.unref();
};

const stopMediaCleanupWorker = () => {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = undefined;
};

module.exports = {
  drainMediaCleanupJobs,
  enqueueMediaCleanup,
  processNextMediaCleanupJob,
  startMediaCleanupWorker,
  stopMediaCleanupWorker,
};
