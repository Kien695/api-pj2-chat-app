const cloudinary = require("cloudinary").v2;
const CLOUDINARY_UPLOAD_CONCURRENCY = 3;
const CLOUDINARY_CLEANUP_CONCURRENCY = 5;
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});

const destroyAsset = (asset) => {
  if (!asset?.public_id) return Promise.resolve();
  return cloudinary.uploader.destroy(asset.public_id, {
    resource_type: asset.resource_type || "image",
  });
};

const runWithConcurrency = async (items, limit, worker) => {
  if (!Array.isArray(items)) throw new TypeError("Items must be an array");
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("Concurrency limit must be a positive integer");
  }
  if (typeof worker !== "function") throw new TypeError("Worker is required");

  const results = new Array(items.length);
  const errors = [];
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        errors.push({ error, index });
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      () => run(),
    ),
  );
  return { errors, results };
};

const cleanupAssets = async (assets = []) => {
  const { errors } = await runWithConcurrency(
    assets,
    CLOUDINARY_CLEANUP_CONCURRENCY,
    destroyAsset,
  );
  if (errors.length > 0) {
    throw new AggregateError(
      errors.map(({ error }) => error),
      "Cloudinary cleanup failed",
    );
  }
};

module.exports = {
  CLOUDINARY_CLEANUP_CONCURRENCY,
  CLOUDINARY_UPLOAD_CONCURRENCY,
  cleanupAssets,
  destroyAsset,
  runWithConcurrency,
};
