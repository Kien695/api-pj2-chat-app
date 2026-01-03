const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");
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
      let stream = cloudinary.uploader.upload_stream((error, result) => {
        if (result) {
          resolve(result);
        } else {
          reject(error);
        }
      });

      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });
  };
  try {
    let result = await streamUpload(req);

    req.body.image = result.secure_url;
    req.body.image_id = result.public_id;

    next();
  } catch (error) {
    console.error("Upload failed:", error);
    res.status(500).json({ message: "Upload failed", error });
  }
};
