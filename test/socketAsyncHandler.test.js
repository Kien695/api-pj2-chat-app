const assert = require("node:assert/strict");
const test = require("node:test");

const socketAsyncHandler = require("../utils/socketAsyncHandler");

test("socket async handler forwards arguments and resolves successfully", async () => {
  const received = [];
  const handler = socketAsyncHandler(
    async (...args) => {
      received.push(...args);
      return "done";
    },
    () => assert.fail("error handler must not run"),
  );

  const result = await handler("message", 42);

  assert.equal(result, "done");
  assert.deepEqual(received, ["message", 42]);
});

test("socket async handler catches a rejected promise exactly once", async () => {
  const expectedError = new Error("database unavailable");
  const errors = [];
  const handler = socketAsyncHandler(
    async () => {
      throw expectedError;
    },
    (error, args) => {
      errors.push({ error, args });
    },
  );

  await handler({ roomChatId: "room-1" });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, expectedError);
  assert.deepEqual(errors[0].args, [{ roomChatId: "room-1" }]);
});

test("socket async handler also catches a synchronous exception", async () => {
  const expectedError = new Error("invalid payload");
  let receivedError;
  const handler = socketAsyncHandler(
    () => {
      throw expectedError;
    },
    (error) => {
      receivedError = error;
    },
  );

  await handler();

  assert.equal(receivedError, expectedError);
});

test("socket async handler rejects invalid configuration", () => {
  assert.throws(() => socketAsyncHandler(null, () => {}), TypeError);
  assert.throws(() => socketAsyncHandler(() => {}, null), TypeError);
});
