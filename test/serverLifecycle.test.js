const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { listen, shutdownServices } = require("../utils/serverLifecycle");

test("listen resolves only after the HTTP server starts listening", async () => {
  const server = new EventEmitter();
  server.listen = (port) => {
    assert.equal(port, 5000);
    queueMicrotask(() => server.emit("listening"));
  };

  await listen(server, 5000);
});

test("listen rejects an HTTP startup error", async () => {
  const expectedError = new Error("address already in use");
  const server = new EventEmitter();
  server.listen = () => queueMicrotask(() => server.emit("error", expectedError));

  await assert.rejects(listen(server, 5000), expectedError);
});

test("shutdown closes every open service", async () => {
  const closed = [];
  const io = { close: (done) => { closed.push("socket"); done(); } };
  const server = {
    listening: true,
    close: () => assert.fail("Socket.IO closes its attached HTTP server"),
  };
  const redisClient = {
    isOpen: true,
    quit: async () => { closed.push("redis"); },
  };
  const database = {
    disconnect: async () => { closed.push("mongo"); },
  };

  await shutdownServices({ io, server, redisClient, database });

  assert.deepEqual(closed, ["socket", "redis", "mongo"]);
});

test("shutdown closes a standalone HTTP server when Socket.IO is absent", async () => {
  let httpClosed = false;
  const server = {
    listening: true,
    close: (done) => { httpClosed = true; done(); },
  };

  await shutdownServices({ server });

  assert.equal(httpClosed, true);
});

test("shutdown attempts remaining cleanup when one service fails", async () => {
  const closed = [];
  const expectedError = new Error("socket close failed");
  const io = { close: (done) => done(expectedError) };
  const redisClient = {
    isOpen: true,
    quit: async () => { closed.push("redis"); },
  };
  const database = {
    disconnect: async () => { closed.push("mongo"); },
  };

  await assert.rejects(
    shutdownServices({ io, redisClient, database }),
    (error) => error instanceof AggregateError && error.errors[0] === expectedError,
  );
  assert.deepEqual(closed.sort(), ["mongo", "redis"]);
});

test("shutdown waits for Socket.IO before closing Redis and MongoDB", async () => {
  const closed = [];
  let finishSocketShutdown;
  const io = {
    close: (done) => {
      closed.push("socket-started");
      finishSocketShutdown = done;
    },
  };
  const redisClient = {
    isOpen: true,
    quit: async () => { closed.push("redis"); },
  };
  const database = {
    disconnect: async () => { closed.push("mongo"); },
  };

  const shutdown = shutdownServices({
    io,
    redisClient,
    database,
    timeoutMs: 1_000,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closed, ["socket-started"]);

  finishSocketShutdown();
  await shutdown;
  assert.deepEqual(closed, ["socket-started", "redis", "mongo"]);
});

test("shutdown timeout forces HTTP connections closed and continues cleanup", async () => {
  const closed = [];
  const io = { close: () => { closed.push("socket-timeout"); } };
  const server = {
    listening: true,
    closeAllConnections: () => { closed.push("http-forced"); },
  };
  const redisClient = {
    isOpen: true,
    quit: async () => { closed.push("redis"); },
  };
  const database = {
    disconnect: async () => { closed.push("mongo"); },
  };

  await assert.rejects(
    shutdownServices({ io, server, redisClient, database, timeoutMs: 20 }),
    (error) =>
      error instanceof AggregateError &&
      error.errors.some((item) => item.message.includes("Socket.IO shutdown")),
  );

  assert.deepEqual(closed, [
    "socket-timeout",
    "http-forced",
    "redis",
    "mongo",
  ]);
});
