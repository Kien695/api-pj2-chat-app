const ALLOWED_PROFILE_FIELDS = new Set([
  "name",
  "mobile",
  "date_of_birth",
  "gender",
]);

class ProfileUpdateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProfileUpdateValidationError";
    this.status = 400;
    this.code = "INVALID_PROFILE_UPDATE";
  }
}

const invalidProfile = (message) => {
  throw new ProfileUpdateValidationError(message);
};

const isValidDateOnly = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validateProfileUpdate = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    invalidProfile("Dữ liệu cập nhật hồ sơ không hợp lệ");
  }

  const fields = Object.keys(payload);
  if (fields.length === 0) invalidProfile("Không có thông tin hồ sơ để cập nhật");

  const unknownField = fields.find(
    (field) => !ALLOWED_PROFILE_FIELDS.has(field) || field.startsWith("$") || field.includes("."),
  );
  if (unknownField) invalidProfile(`Trường cập nhật không được phép: ${unknownField}`);

  const set = {};
  const unset = {};

  if (Object.hasOwn(payload, "name")) {
    if (typeof payload.name !== "string") invalidProfile("Tên hiển thị không hợp lệ");
    const name = payload.name.trim();
    if (name.length < 1 || name.length > 100) {
      invalidProfile("Tên hiển thị phải có từ 1 đến 100 ký tự");
    }
    set.name = name;
  }

  if (Object.hasOwn(payload, "mobile")) {
    if (typeof payload.mobile !== "string") invalidProfile("Số điện thoại không hợp lệ");
    const mobile = payload.mobile.trim();
    if (mobile === "") unset.mobile = 1;
    else if (!/^\d{8,15}$/.test(mobile)) {
      invalidProfile("Số điện thoại phải gồm từ 8 đến 15 chữ số");
    } else set.mobile = mobile;
  }

  if (Object.hasOwn(payload, "date_of_birth")) {
    if (typeof payload.date_of_birth !== "string") invalidProfile("Ngày sinh không hợp lệ");
    const dateOfBirth = payload.date_of_birth.trim();
    if (dateOfBirth === "") unset.date_of_birth = 1;
    else if (
      !isValidDateOnly(dateOfBirth) ||
      new Date(`${dateOfBirth}T00:00:00.000Z`) > new Date()
    ) invalidProfile("Ngày sinh không hợp lệ");
    else set.date_of_birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  }

  if (Object.hasOwn(payload, "gender")) {
    if (typeof payload.gender !== "string" || !["", "Male", "Female"].includes(payload.gender)) {
      invalidProfile("Giới tính không hợp lệ");
    }
    set.gender = payload.gender;
  }

  return { set, unset };
};

module.exports = { ProfileUpdateValidationError, validateProfileUpdate };
