const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { sendInternalServerError } = require("../utils/httpErrorResponse");
const { handleHttpError } = require("../middleware/error.middleware");

test("internal errors are logged without exposing provider details to clients", () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);

  let status;
  let body;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  try {
    sendInternalServerError(
      res,
      Object.assign(new Error("mongodb://secret-host"), { code: 123 }),
      "Room operation failed",
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(status, 500);
  assert.deepEqual(body, {
    message: "Lỗi server",
    error: true,
    success: false,
  });
  assert.equal(JSON.stringify(body).includes("secret-host"), false);
  assert.deepEqual(logs, [
    ["Room operation failed", { name: "Error", code: 123 }],
  ]);
});

test("chat upload does not expose internal error messages", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../controller/chat.controller.js"),
    "utf8",
  );

  assert.equal(source.includes("message: error.message"), false);
  assert.match(source, /sendInternalServerError\(res, error/);
});

test("profile handlers use safe internal error responses", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../controller/user.controller.js"),
    "utf8",
  );
  const start = source.indexOf("module.exports.userDetail");
  const end = source.indexOf("module.exports.getUser", start);
  const profileHandlers = source.slice(start, end);

  assert.equal(profileHandlers.includes("message: error.message || error"), false);
  assert.equal(
    profileHandlers.match(/sendInternalServerError\(res, error/g)?.length,
    3,
  );
  assert.match(profileHandlers, /error instanceof ProfileUpdateValidationError/);
  assert.match(profileHandlers, /error\?\.code === 11000/);
});

test("user lookup and friend-list handlers use safe internal errors", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../controller/user.controller.js"),
    "utf8",
  );
  const start = source.indexOf("module.exports.getUser");
  const end = source.indexOf("//add member for group", start);
  const lookupHandlers = source.slice(start, end);

  assert.equal(lookupHandlers.includes("message: error.message || error"), false);
  assert.equal(
    lookupHandlers.match(/sendInternalServerError\(res, error/g)?.length,
    5,
  );
  assert.match(lookupHandlers, /return res\.status\(404\)/);
});

test("HTTP fallback returns safe JSON and delegates after headers are sent", () => {
  const originalError = console.error;
  console.error = () => {};
  let status;
  let body;
  let delegated;
  const error = new Error("database host is secret");
  const res = {
    headersSent: false,
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  try {
    handleHttpError(error, {}, res, (value) => {
      delegated = value;
    });
    assert.equal(status, 500);
    assert.equal(JSON.stringify(body).includes("secret"), false);
    assert.equal(delegated, undefined);

    res.headersSent = true;
    handleHttpError(error, {}, res, (value) => {
      delegated = value;
    });
    assert.equal(delegated, error);
  } finally {
    console.error = originalError;
  }
});

test("HTTP error middleware is registered after every API router", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../router/index.router.js"),
    "utf8",
  );

  assert.ok(source.indexOf('app.use("/chat"') < source.indexOf("app.use(handleHttpError)"));
});
