const assert = require("node:assert/strict");
const test = require("node:test");
const { validateProfileUpdate } = require("../service/profileUpdateValidation.service");

test("accepts and normalizes the four editable profile fields", () => {
  const result = validateProfileUpdate({
    name: "  Nguyen Van A  ", mobile: "0123456789",
    date_of_birth: "2000-02-29", gender: "Male",
  });
  assert.equal(result.set.name, "Nguyen Van A");
  assert.equal(result.set.mobile, "0123456789");
  assert.equal(result.set.date_of_birth.toISOString(), "2000-02-29T00:00:00.000Z");
  assert.equal(result.set.gender, "Male");
  assert.deepEqual(result.unset, {});
});

test("rejects system fields to prevent mass assignment", () => {
  for (const field of ["password", "refresh_token", "verify_email", "status", "FriendList"]) {
    assert.throws(
      () => validateProfileUpdate({ name: "Valid name", [field]: "attack" }),
      (error) => error.code === "INVALID_PROFILE_UPDATE" && error.status === 400,
    );
  }
});

test("rejects MongoDB operators and dotted paths", () => {
  assert.throws(() => validateProfileUpdate({ $set: { verify_email: true } }));
  assert.throws(() => validateProfileUpdate({ "FriendList.0.user_id": "attack" }));
});

test("rejects invalid field types and values", () => {
  assert.throws(() => validateProfileUpdate({ name: { $ne: null } }));
  assert.throws(() => validateProfileUpdate({ mobile: "123abc" }));
  assert.throws(() => validateProfileUpdate({ date_of_birth: "2001-02-29" }));
  assert.throws(() => validateProfileUpdate({ gender: "Admin" }));
});

test("turns empty optional values into safe updates", () => {
  assert.deepEqual(validateProfileUpdate({ mobile: "", date_of_birth: "", gender: "" }), {
    set: { gender: "" }, unset: { mobile: 1, date_of_birth: 1 },
  });
});
