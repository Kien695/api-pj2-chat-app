const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const MAX_SEARCH_KEYWORD_LENGTH = 254;
const MAX_ROOM_TITLE_LENGTH = 100;
const MAX_ROOM_MEMBERS = 100;

class RestInputValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RestInputValidationError";
    this.code = code;
  }
}

const invalidInput = (code, message) => {
  throw new RestInputValidationError(code, message);
};

const validateSearchKeyword = (value) => {
  if (typeof value !== "string") {
    invalidInput("INVALID_SEARCH_KEYWORD", "Từ khóa tìm kiếm không hợp lệ");
  }
  const keyword = value.trim();
  if (!keyword || keyword.length > MAX_SEARCH_KEYWORD_LENGTH || /[\u0000-\u001f\u007f]/.test(keyword)) {
    invalidInput("INVALID_SEARCH_KEYWORD", "Từ khóa tìm kiếm không hợp lệ");
  }
  return keyword;
};

const validateObjectId = (value, code, message) => {
  if (typeof value !== "string" || !OBJECT_ID_PATTERN.test(value)) {
    invalidInput(code, message);
  }
  return value.toLowerCase();
};

const validateRoomTitle = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length > MAX_ROOM_TITLE_LENGTH) {
    invalidInput("INVALID_ROOM_TITLE", "Tên phòng chat không hợp lệ");
  }
  return value.trim();
};

const validateRoomMembers = (value) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ROOM_MEMBERS) {
    invalidInput("INVALID_ROOM_MEMBERS", "Danh sách thành viên không hợp lệ");
  }
  const members = value.map((memberId) =>
    validateObjectId(
      memberId,
      "INVALID_ROOM_MEMBER_ID",
      "Mã thành viên không hợp lệ",
    ));
  return [...new Set(members)];
};

const validateCreateRoomPayload = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalidInput("INVALID_ROOM_PAYLOAD", "Thông tin phòng chat không hợp lệ");
  }
  return {
    title: validateRoomTitle(body.title),
    members: validateRoomMembers(body.members),
  };
};

const validateAddMembersPayload = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalidInput("INVALID_ROOM_PAYLOAD", "Thông tin phòng chat không hợp lệ");
  }
  return { members: validateRoomMembers(body.members) };
};

const validateRemoveMemberPayload = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    invalidInput("INVALID_ROOM_PAYLOAD", "Thông tin phòng chat không hợp lệ");
  }
  return {
    memberId: validateObjectId(
      body.memberId,
      "INVALID_ROOM_MEMBER_ID",
      "Mã thành viên không hợp lệ",
    ),
  };
};

module.exports = {
  MAX_ROOM_MEMBERS,
  MAX_ROOM_TITLE_LENGTH,
  MAX_SEARCH_KEYWORD_LENGTH,
  RestInputValidationError,
  validateAddMembersPayload,
  validateCreateRoomPayload,
  validateRemoveMemberPayload,
  validateRoomTitle,
  validateSearchKeyword,
};
