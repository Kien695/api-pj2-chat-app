const multer = require("multer");

const MEBIBYTE = 1024 * 1024;
const PROFILE_IMAGE_MAX_BYTES = 8 * MEBIBYTE;
const CHAT_IMAGE_MAX_BYTES = 8 * MEBIBYTE;
const CHAT_IMAGE_MAX_COUNT = 5;
const CHAT_FILE_MAX_BYTES = 10 * MEBIBYTE;
const CHAT_FILE_MAX_COUNT = 5;

const memoryStorage = multer.memoryStorage();

const profileImageUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: PROFILE_IMAGE_MAX_BYTES,
    files: 1,
    fields: 2,
    fieldSize: 10 * 1024,
    parts: 3,
  },
}).single("image");

const chatFileUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: CHAT_FILE_MAX_BYTES,
    files: CHAT_FILE_MAX_COUNT,
    fields: 1,
    fieldSize: 10 * 1024,
    parts: CHAT_FILE_MAX_COUNT + 1,
  },
}).array("files", CHAT_FILE_MAX_COUNT);

const chatImageUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: CHAT_IMAGE_MAX_BYTES,
    files: CHAT_IMAGE_MAX_COUNT,
    fields: 1,
    fieldSize: 10 * 1024,
    parts: CHAT_IMAGE_MAX_COUNT + 1,
  },
}).array("images", CHAT_IMAGE_MAX_COUNT);

const mapUploadError = (error) => {
  if (!(error instanceof multer.MulterError)) return null;
  const tooLarge = error.code === "LIMIT_FILE_SIZE";
  return {
    status: tooLarge ? 413 : 400,
    body: {
      success: false,
      error: true,
      code: error.code,
      message: tooLarge
        ? "File tải lên vượt quá giới hạn cho phép"
        : "Yêu cầu tải file không hợp lệ",
    },
  };
};

const handleUpload = (uploadMiddleware) =>
  function multerMiddleware(req, res, next) {
    uploadMiddleware(req, res, (error) => {
      if (!error) return next();
      const mapped = mapUploadError(error);
      if (mapped) return res.status(mapped.status).json(mapped.body);
      return next(error);
    });
  };

module.exports = {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_MAX_COUNT,
  PROFILE_IMAGE_MAX_BYTES,
  chatImageUpload: handleUpload(chatImageUpload),
  chatFileUpload: handleUpload(chatFileUpload),
  mapUploadError,
  profileImageUpload: handleUpload(profileImageUpload),
};
