const assert = require("node:assert/strict");
const test = require("node:test");
const search = require("../helper/search");
const {
  RestInputValidationError,
  validateAddMembersPayload,
  validateCreateRoomPayload,
  validateRemoveMemberPayload,
  validateRoomTitle,
  validateSearchKeyword,
} = require("../service/restInputValidation.service");

const memberId = "507F191E810C19729DE860EA";

test("normalizes bounded search keywords and escapes regex syntax", () => {
  assert.equal(validateSearchKeyword("  user@example.com  "), "user@example.com");
  assert.deepEqual(search({ keyword: ".*+?" }), {
    mobile: { $regex: "^\\.\\*\\+\\?" },
  });
});

test("rejects non-string, empty, control and oversized search keywords", () => {
  for (const value of [null, {}, [], "   ", "bad\u0000value", "x".repeat(255)]) {
    assert.throws(() => validateSearchKeyword(value), RestInputValidationError);
  }
});

test("normalizes create-room and add-member payloads", () => {
  assert.deepEqual(
    validateCreateRoomPayload({ title: "  Nhóm A  ", members: [memberId, memberId.toLowerCase()] }),
    { title: "Nhóm A", members: [memberId.toLowerCase()] },
  );
  assert.deepEqual(validateAddMembersPayload({ members: [memberId] }), {
    members: [memberId.toLowerCase()],
  });
  assert.equal(validateRoomTitle(undefined), undefined);
});

test("rejects invalid room member collections and titles", () => {
  for (const body of [null, {}, { members: [] }, { members: [{ $ne: null }] }]) {
    assert.throws(() => validateCreateRoomPayload(body), RestInputValidationError);
  }
  assert.throws(() => validateRoomTitle("x".repeat(101)), RestInputValidationError);
});

test("accepts only a canonical remove-member id", () => {
  assert.deepEqual(validateRemoveMemberPayload({ memberId }), {
    memberId: memberId.toLowerCase(),
  });
  for (const body of [null, {}, { memberId: [] }, { memberId: { $ne: null } }]) {
    assert.throws(() => validateRemoveMemberPayload(body), RestInputValidationError);
  }
});
