const {
  UploadedFileValidationError,
  validateChatFile,
  validateProfileImage,
} = require("../service/uploadedFileValidation.service");

const sendValidationError = (res, error) =>
  res.status(error.status).json({
    success: false,
    error: true,
    code: error.code,
    message: error.message,
  });

const validateProfileImageUpload = (req, res, next) => {
  try {
    if (req.file) req.file = validateProfileImage(req.file);
    next();
  } catch (error) {
    if (error instanceof UploadedFileValidationError) {
      return sendValidationError(res, error);
    }
    return next(error);
  }
};

const requireProfileImageUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: true,
      code: "IMAGE_REQUIRED",
      message: "Vui lòng chọn ảnh để tải lên",
    });
  }
  return validateProfileImageUpload(req, res, next);
};

const validateChatFileUploads = (req, res, next) => {
  try {
    if (!Array.isArray(req.files) || req.files.length === 0) {
      throw new UploadedFileValidationError("FILE_REQUIRED", "Vui lòng chọn ít nhất một file");
    }
    req.files = req.files.map(validateChatFile);
    next();
  } catch (error) {
    if (error instanceof UploadedFileValidationError) {
      return sendValidationError(res, error);
    }
    return next(error);
  }
};

module.exports = {
  requireProfileImageUpload,
  validateChatFileUploads,
  validateProfileImageUpload,
};
