const mongoose = require("mongoose");
const MediaCleanupJob = require("../model/media-cleanup-job.model");
const {
  RoomAuthorizationError,
} = require("./roomAuthorization.service");

const invalidLease = () =>
  new RoomAuthorizationError(
    400,
    "INVALID_UPLOAD_CLEANUP_LEASE",
    "Thông tin xác nhận file upload không hợp lệ",
  );

const assetKey = ({ public_id, url }) => `${public_id}\u0000${url || ""}`;

const assertCleanupLeaseMatchesFiles = (jobs, files) => {
  const filesByJobId = new Map();
  files.forEach((file) => {
    const jobId = file.cleanup_job_id;
    if (!mongoose.Types.ObjectId.isValid(jobId)) throw invalidLease();
    if (!filesByJobId.has(jobId)) filesByJobId.set(jobId, []);
    filesByJobId.get(jobId).push(file);
  });

  if (jobs.length !== filesByJobId.size) throw invalidLease();

  jobs.forEach((job) => {
    const claimedFiles = filesByJobId.get(job._id.toString());
    if (!claimedFiles) throw invalidLease();

    const expectedAssets = job.assets.map(assetKey).sort();
    const claimedAssets = claimedFiles.map(assetKey).sort();
    if (
      expectedAssets.length !== claimedAssets.length ||
      expectedAssets.some((asset, index) => asset !== claimedAssets[index])
    ) {
      throw invalidLease();
    }
  });
};

const consumeUploadCleanupLeases = async ({ files, userId, session }) => {
  if (files.length === 0) return;
  const jobIds = [...new Set(files.map((file) => file.cleanup_job_id))];
  if (jobIds.some((jobId) => !mongoose.Types.ObjectId.isValid(jobId))) {
    throw invalidLease();
  }

  const jobs = await MediaCleanupJob.find({
    _id: { $in: jobIds },
    ownerId: userId,
    status: "pending",
  }).session(session);

  assertCleanupLeaseMatchesFiles(jobs, files);
  const deletion = await MediaCleanupJob.deleteMany(
    { _id: { $in: jobIds }, ownerId: userId, status: "pending" },
    { session },
  );
  if (deletion.deletedCount !== jobIds.length) throw invalidLease();
};

module.exports = {
  assertCleanupLeaseMatchesFiles,
  consumeUploadCleanupLeases,
};
