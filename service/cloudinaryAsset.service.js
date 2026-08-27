const cloudinary = require("cloudinary").v2;
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

const cleanupAssets = async (assets = []) => {
  const results = await Promise.allSettled(assets.map(destroyAsset));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      "Cloudinary cleanup failed",
    );
  }
};

const uploadImagesWithCompensation = async (base64Images = []) => {
  const uploaded = [];
  try {
    for (const base64 of base64Images) {
      const result = await cloudinary.uploader.upload(base64, {
        folder: "chat_app",
      });
      uploaded.push({
        url: result.secure_url,
        public_id: result.public_id,
        resource_type: "image",
      });
    }
    return uploaded;
  } catch (error) {
    await cleanupAssets(uploaded).catch((cleanupError) => {
      console.error("Cloudinary upload compensation failed", cleanupError);
    });
    throw error;
  }
};

module.exports = {
  cleanupAssets,
  destroyAsset,
  uploadImagesWithCompensation,
};
