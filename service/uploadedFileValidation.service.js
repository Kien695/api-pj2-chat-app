const path = require("path");

class UploadedFileValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UploadedFileValidationError";
    this.status = 415;
    this.code = code;
  }
}

const invalidFile = (code, message) => {
  throw new UploadedFileValidationError(code, message);
};

const validateFileName = (originalName) => {
  if (
    typeof originalName !== "string" ||
    originalName.length < 1 ||
    originalName.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(originalName)
  ) {
    invalidFile("UNSAFE_FILE_NAME", "Tên file không hợp lệ");
  }
  const normalized = originalName.normalize("NFC").trim();
  if (!normalized || normalized === "." || normalized === "..") {
    invalidFile("UNSAFE_FILE_NAME", "Tên file không hợp lệ");
  }
  return normalized;
};

const startsWith = (buffer, signature) =>
  signature.every((value, index) => buffer[index] === value);

const detectImage = (buffer) => {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { mime: "image/jpeg", extensions: new Set([".jpg", ".jpeg"]) };
  }
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", extensions: new Set([".png"]) };
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", extensions: new Set([".webp"]) };
  }
  return null;
};

const validateDeclaredType = (file, detected, fileName) => {
  const extension = path.extname(fileName).toLowerCase();
  if (file.mimetype !== detected.mime || !detected.extensions.has(extension)) {
    invalidFile(
      "FILE_TYPE_MISMATCH",
      "Nội dung, MIME hoặc phần mở rộng file không khớp",
    );
  }
};

const validateProfileImage = (file) => {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    invalidFile("IMAGE_REQUIRED", "Vui lòng chọn ảnh hợp lệ");
  }
  const fileName = validateFileName(file.originalname);
  const detected = detectImage(file.buffer);
  if (!detected) {
    invalidFile("UNSUPPORTED_IMAGE_TYPE", "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP");
  }
  validateDeclaredType(file, detected, fileName);
  return { ...file, originalname: fileName, verifiedMime: detected.mime };
};

const isLikelyText = (buffer) => {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 64 * 1024));
  const text = sample.toString("utf8");
  if (text.includes("\ufffd")) return false;
  let unsafeControls = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 32 && ![9, 10, 13].includes(code)) unsafeControls += 1;
  }
  return text.length === 0 || unsafeControls / text.length < 0.01;
};

const detectOfficeOpenXml = (buffer, extension) => {
  if (!startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return null;
  const archiveText = buffer.toString("latin1");
  if (!archiveText.includes("[Content_Types].xml")) return null;
  const officeTypes = {
    ".docx": { marker: "word/", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ".xlsx": { marker: "xl/", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ".pptx": { marker: "ppt/", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  };
  const type = officeTypes[extension];
  return type && archiveText.includes(type.marker)
    ? { mime: type.mime, extensions: new Set([extension]) }
    : null;
};

const validateChatFile = (file) => {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    invalidFile("FILE_REQUIRED", "File tải lên không hợp lệ");
  }
  const fileName = validateFileName(file.originalname);
  const extension = path.extname(fileName).toLowerCase();
  let detected = detectImage(file.buffer);

  if (!detected && startsWith(file.buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    detected = { mime: "application/pdf", extensions: new Set([".pdf"]) };
  }
  if (!detected) detected = detectOfficeOpenXml(file.buffer, extension);
  if (!detected && [".txt", ".csv", ".json"].includes(extension) && isLikelyText(file.buffer)) {
    const mimeByExtension = {
      ".txt": "text/plain",
      ".csv": "text/csv",
      ".json": "application/json",
    };
    if (extension === ".json") {
      try {
        JSON.parse(file.buffer.toString("utf8"));
      } catch {
        invalidFile("INVALID_JSON_FILE", "Nội dung JSON không hợp lệ");
      }
    }
    detected = { mime: mimeByExtension[extension], extensions: new Set([extension]) };
  }
  if (!detected) {
    invalidFile("UNSUPPORTED_FILE_TYPE", "Định dạng file không được hỗ trợ");
  }
  validateDeclaredType(file, detected, fileName);
  return { ...file, originalname: fileName, verifiedMime: detected.mime };
};

module.exports = {
  UploadedFileValidationError,
  validateChatFile,
  validateFileName,
  validateProfileImage,
};
