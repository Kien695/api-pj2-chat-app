const {
  RoomAuthorizationError,
} = require("./roomAuthorization.service");

const ALLOWED_MESSAGE_TYPES = new Set([
  "text",
  "image",
  "file",
  "emoji",
  "invite",
]);
const MAX_MESSAGE_LENGTH = 10_000;
const MAX_IMAGE_COUNT = 5;
const MAX_IMAGE_BASE64_LENGTH = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 10;

const invalidPayload = (message) =>
  new RoomAuthorizationError(400, "INVALID_MESSAGE_PAYLOAD", message);

const validateMessagePayload = ({ message, images, file, type }) => {
  if (!ALLOWED_MESSAGE_TYPES.has(type)) {
    throw invalidPayload("Loại tin nhắn không hợp lệ");
  }

  if (typeof message !== "string") {
    throw invalidPayload("Nội dung tin nhắn không hợp lệ");
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw invalidPayload("Nội dung tin nhắn vượt quá giới hạn");
  }

  const normalizedImages = images === "" || images == null ? [] : images;
  if (
    !Array.isArray(normalizedImages) ||
    normalizedImages.length > MAX_IMAGE_COUNT ||
    normalizedImages.some(
      (image) =>
        typeof image !== "string" ||
        image.length === 0 ||
        image.length > MAX_IMAGE_BASE64_LENGTH,
    )
  ) {
    throw invalidPayload("Danh sách ảnh không hợp lệ");
  }

  const normalizedFiles = file === "" || file == null ? [] : file;
  if (
    !Array.isArray(normalizedFiles) ||
    normalizedFiles.length > MAX_FILE_COUNT ||
    normalizedFiles.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof item.url !== "string" ||
        typeof item.public_id !== "string" ||
        typeof item.cleanup_job_id !== "string" ||
        item.url.length === 0 ||
        item.public_id.length === 0 ||
        !/^[a-f\d]{24}$/i.test(item.cleanup_job_id),
    )
  ) {
    throw invalidPayload("Danh sách file không hợp lệ");
  }

  const hasText = message.trim().length > 0;
  const hasImages = normalizedImages.length > 0;
  const hasFiles = normalizedFiles.length > 0;
  const validContentByType = {
    text: hasText || hasImages,
    image: hasImages,
    file: hasFiles,
    emoji: hasText,
    invite: hasText,
  };

  if (!validContentByType[type]) {
    throw invalidPayload("Tin nhắn không được để trống");
  }

  return {
    message: hasText ? message.trim() : "",
    images: normalizedImages,
    files: normalizedFiles,
    type,
  };
};

module.exports = {
  validateMessagePayload,
};
