const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const {
  assertCleanupLeaseMatchesFiles,
} = require("../service/uploadCleanupLease.service");

const jobId = new mongoose.Types.ObjectId();
const job = {
  _id: jobId,
  assets: [
    { public_id: "chat/files/a", url: "https://cdn.example/a" },
    { public_id: "chat/files/b", url: "https://cdn.example/b" },
  ],
};

test("accepts a cleanup lease only for its exact uploaded assets", () => {
  assert.doesNotThrow(() =>
    assertCleanupLeaseMatchesFiles([job], [
      {
        cleanup_job_id: jobId.toString(),
        public_id: "chat/files/b",
        url: "https://cdn.example/b",
      },
      {
        cleanup_job_id: jobId.toString(),
        public_id: "chat/files/a",
        url: "https://cdn.example/a",
      },
    ]),
  );
});

test("rejects a public_id or URL not owned by the cleanup lease", () => {
  assert.throws(
    () =>
      assertCleanupLeaseMatchesFiles([job], [
        {
          cleanup_job_id: jobId.toString(),
          public_id: "chat/files/a",
          url: "https://attacker.example/file",
        },
        {
          cleanup_job_id: jobId.toString(),
          public_id: "chat/files/b",
          url: "https://cdn.example/b",
        },
      ]),
    (error) => error.code === "INVALID_UPLOAD_CLEANUP_LEASE",
  );
});

test("rejects missing jobs and incomplete asset claims", () => {
  assert.throws(() =>
    assertCleanupLeaseMatchesFiles([], [
      {
        cleanup_job_id: jobId.toString(),
        public_id: "chat/files/a",
        url: "https://cdn.example/a",
      },
    ]),
  );
  assert.throws(() =>
    assertCleanupLeaseMatchesFiles([job], [
      {
        cleanup_job_id: jobId.toString(),
        public_id: "chat/files/a",
        url: "https://cdn.example/a",
      },
    ]),
  );
});
