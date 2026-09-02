const { createAdapter } = require("@socket.io/redis-adapter");

const closeRedisClient = async (client) => {
  if (!client) return;
  if (client.isOpen) {
    await client.quit();
    return;
  }
  client.destroy?.();
};

const attachSocketRedisAdapter = async ({
  io,
  redisClient,
  adapterFactory = createAdapter,
  logger = console,
}) => {
  if (!io || typeof io.adapter !== "function") {
    throw new TypeError("A Socket.IO server is required");
  }
  if (!redisClient || typeof redisClient.duplicate !== "function") {
    throw new TypeError("A connected Redis client is required");
  }

  const pubClient = redisClient.duplicate();
  const subClient = redisClient.duplicate();
  let closed = false;

  const logRedisError = (role) => (error) => {
    logger.error(`Socket.IO Redis ${role} client error:`, error);
  };
  pubClient.on("error", logRedisError("publisher"));
  subClient.on("error", logRedisError("subscriber"));

  const close = async () => {
    if (closed) return;
    closed = true;
    const results = await Promise.allSettled([
      closeRedisClient(pubClient),
      closeRedisClient(subClient),
    ]);
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "Failed to close Socket.IO Redis adapter clients",
      );
    }
  };

  try {
    const connectionResults = await Promise.allSettled([
      pubClient.connect(),
      subClient.connect(),
    ]);
    const connectionErrors = connectionResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (connectionErrors.length > 0) {
      throw connectionErrors.length === 1
        ? connectionErrors[0]
        : new AggregateError(
            connectionErrors,
            "Failed to connect Socket.IO Redis adapter clients",
          );
    }
    io.adapter(adapterFactory(pubClient, subClient));
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Failed to initialize Socket.IO Redis adapter",
      );
    }
    throw error;
  }

  return { close, pubClient, subClient };
};

module.exports = { attachSocketRedisAdapter, closeRedisClient };
