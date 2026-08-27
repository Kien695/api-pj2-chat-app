const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
const IMAGE_UPLOAD_OPTIONS = {
  resource_type: "image",
  folder: "chat/images",
  use_filename: false,
  unique_filename: true,
  overwrite: false,
};
const RAW_UPLOAD_OPTIONS = {
  resource_type: "raw",
  folder: "chat/files",
  use_filename: false,
  unique_filename: true,
  overwrite: false,
};
//cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

//upload one
module.exports.uploadOne = async (req, res, next) => {
  if (!req.file) {
    return next();
  }
  const streamUpload = (req) => {
    return new Promise((resolve, reject) => {
      let stream = cloudinary.uploader.upload_stream(
        IMAGE_UPLOAD_OPTIONS,
        (error, result) => {
          if (result?.secure_url?.startsWith("https://") && result.public_id) {
            resolve(result);
          } else {
            reject(error || new Error("Invalid Cloudinary image response"));
          }
        },
      );

      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });
  };
  try {
    let result = await streamUpload(req);

    req.body.image = result.secure_url;
    req.body.image_id = result.public_id;
    req.uploadedCloudinaryAssets = [
      { public_id: result.public_id, resource_type: "image" },
    ];

    next();
  } catch (error) {
    console.error("Cloudinary image upload failed", error?.message);
    res.status(502).json({
      success: false,
      error: true,
      code: "IMAGE_UPLOAD_PROVIDER_FAILED",
      message: "Không thể tải ảnh lên dịch vụ lưu trữ",
    });
  }
};
//upload file
module.exports.uploadFile = async (req, res, next) => {
  if (!req.files || !req.files.length) return next();

  const uploadedFiles = [];
  try {
    for (const file of req.files) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          RAW_UPLOAD_OPTIONS,
          (err, result) => {
            if (result?.secure_url?.startsWith("https://") && result.public_id) {
              resolve(result);
            } else reject(err || new Error("Invalid Cloudinary file response"));
          },
        );

        streamifier.createReadStream(file.buffer).pipe(stream);
      });

      uploadedFiles.push({
        url: result.secure_url,
        public_id: result.public_id,
        name: file.originalname,
        size: file.size,
        type: file.verifiedMime,
        resource_type: "raw",
      });
    }

    req.body.files = uploadedFiles;
    req.uploadedCloudinaryAssets = uploadedFiles;
    next();
  } catch (err) {
    const { cleanupAssets } = require("../service/cloudinaryAsset.service");
    await cleanupAssets(uploadedFiles).catch((cleanupError) => {
      console.error("Partial file upload cleanup failed", cleanupError);
    });
    console.error("Cloudinary file upload failed", err?.message);
    return res.status(502).json({
      success: false,
      error: true,
      code: "FILE_UPLOAD_PROVIDER_FAILED",
      message: "Không thể tải file lên dịch vụ lưu trữ",
    });
  }
};

module.exports.IMAGE_UPLOAD_OPTIONS = IMAGE_UPLOAD_OPTIONS;
module.exports.RAW_UPLOAD_OPTIONS = RAW_UPLOAD_OPTIONS;
