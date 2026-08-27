const listen = (server, port) => {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
};

const closeWithCallback = (close) => {
  return new Promise((resolve, reject) => {
    close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const withTimeout = (operation, timeoutMs, label) => {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
};

const shutdownServices = async ({
  io,
  server,
  redisClient,
  database,
  timeoutMs = 10_000,
}) => {
  const errors = [];
  const attempt = async (label, operation) => {
    try {
      await withTimeout(Promise.resolve().then(operation), timeoutMs, label);
    } catch (error) {
      errors.push(error);
    }
  };

  if (io) {
    await attempt("Socket.IO shutdown", () =>
      closeWithCallback((done) => io.close(done)),
    );
  } else if (server?.listening) {
    await attempt("HTTP shutdown", () =>
      closeWithCallback((done) => server.close(done)),
    );
  }

  if (server?.listening && typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }

  if (redisClient?.isOpen) {
    await attempt("Redis shutdown", () => redisClient.quit());
  }
  if (database?.disconnect) {
    await attempt("MongoDB shutdown", () => database.disconnect());
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to close all server resources");
  }
};

module.exports = {
  listen,
  shutdownServices,
  withTimeout,
};
