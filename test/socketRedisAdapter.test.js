const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  attachSocketRedisAdapter,
} = require("../service/socketRedisAdapter.service");

const createFakeClient = ({ connectError } = {}) => ({
  connectCalls: 0,
  destroyCalls: 0,
  isOpen: false,
  listeners: {},
  quitCalls: 0,
  async connect() {
    this.connectCalls += 1;
    if (connectError) throw connectError;
    this.isOpen = true;
  },
  destroy() {
    this.destroyCalls += 1;
  },
  on(event, listener) {
    this.listeners[event] = listener;
  },
  async quit() {
    this.quitCalls += 1;
    this.isOpen = false;
  },
});

const createFixture = (clients) => {
  let duplicateIndex = 0;
  const redisClient = {
    duplicate: () => clients[duplicateIndex++],
  };
  const io = {
    configuredAdapter: null,
    adapter(value) {
      this.configuredAdapter = value;
    },
  };
  return { io, redisClient };
};

test("connects pub/sub clients before attaching the adapter", async () => {
  const pubClient = createFakeClient();
  const subClient = createFakeClient();
  const { io, redisClient } = createFixture([pubClient, subClient]);
  const adapter = { name: "redis-adapter" };
  const manager = await attachSocketRedisAdapter({
    io,
    redisClient,
    adapterFactory: (publisher, subscriber) => {
      assert.equal(publisher.isOpen, true);
      assert.equal(subscriber.isOpen, true);
      return adapter;
    },
  });

  assert.equal(io.configuredAdapter, adapter);
  assert.equal(pubClient.connectCalls, 1);
  assert.equal(subClient.connectCalls, 1);
  await manager.close();
  assert.equal(pubClient.quitCalls, 1);
  assert.equal(subClient.quitCalls, 1);
});

test("close is idempotent", async () => {
  const clients = [createFakeClient(), createFakeClient()];
  const { io, redisClient } = createFixture(clients);
  const manager = await attachSocketRedisAdapter({
    io,
    redisClient,
    adapterFactory: () => ({}),
  });

  await manager.close();
  await manager.close();
  assert.deepEqual(
    clients.map((client) => client.quitCalls),
    [1, 1],
  );
});

test("cleans up both clients when initialization fails", async () => {
  const pubClient = createFakeClient();
  const subClient = createFakeClient({ connectError: new Error("unavailable") });
  const { io, redisClient } = createFixture([pubClient, subClient]);

  await assert.rejects(
    attachSocketRedisAdapter({
      io,
      redisClient,
      adapterFactory: () => ({}),
    }),
    /unavailable/,
  );
  assert.equal(io.configuredAdapter, null);
  assert.equal(pubClient.quitCalls, 1);
  assert.equal(subClient.destroyCalls, 1);
});

test("rejects invalid dependencies", async () => {
  await assert.rejects(
    attachSocketRedisAdapter({ io: {}, redisClient: {} }),
    /Socket.IO server/,
  );
});

test("sidebar events target cross-instance user rooms", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../socket/index.js"),
    "utf8",
  );
  const sidebarBlock = source.slice(
    source.indexOf('io.to(authorizedRoomId).emit("SERVER_RETURN_MASSAGE"'),
    source.indexOf("results.push({", source.indexOf("SERVER_RETURN_SIDEBAR")),
  );

  assert.match(
    sidebarBlock,
    /io\.to\(member\.user_id\.toString\(\)\)\.emit\(/,
  );
  assert.doesNotMatch(sidebarBlock, /onlineUser\.get/);
});
