const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const cookieParser = require("cookie-parser");
const jsonWebToken = require("jsonwebtoken");
const helmet = require("helmet");
const database = require("./config/database");
const { app, server, getIO } = require("./socket/index");
const client = require("./config/redis");
const { listen, shutdownServices } = require("./utils/serverLifecycle");
const {
  startMediaCleanupWorker,
  stopMediaCleanupWorker,
} = require("./service/mediaCleanupJob.service");
const {
  ensureCriticalDatabaseIndexes,
} = require("./service/databaseIndex.service");
const {
  validateAuthenticationConfig,
} = require("./service/authenticationConfig.service");
const {
  attachSocketRedisAdapter,
} = require("./service/socketRedisAdapter.service");
const {
  startPresenceCleanupWorker,
  stopPresenceCleanupWorker,
} = require("./service/presenceCleanupWorker.service");
const {
  startCallTimeoutWorker,
  stopCallTimeoutWorker,
} = require("./service/callTimeoutWorker.service");
const port = process.env.PORT;

app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.FE_URL,
    credentials: true,
  }),
);
app.use(express.json());

app.use(cookieParser());
app.use(helmet());

let isShuttingDown = false;
let socketRedisAdapter = null;

async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Shutting down server: ${signal}`);
  try {
    await stopCallTimeoutWorker();
    await stopPresenceCleanupWorker();
    await stopMediaCleanupWorker();
    await shutdownServices({
      io: getIO(),
      server,
      socketRedisAdapter,
      redisClient: client,
      database,
    });
  } catch (error) {
    console.error("Server shutdown failed:", error);
    exitCode = 1;
  } finally {
    process.exitCode = exitCode;
  }
}

async function startServer() {
  try {
    if (!port) {
      throw new Error("PORT environment variable is required");
    }
    validateAuthenticationConfig();

    await database.connect();
    await ensureCriticalDatabaseIndexes();
    await client.connect();
    socketRedisAdapter = await attachSocketRedisAdapter({
      io: getIO(),
      redisClient: client,
    });

    const router = require("./router/index.router");
    router(app);

    await listen(server, port);
    startCallTimeoutWorker(getIO());
    startPresenceCleanupWorker(getIO());
    startMediaCleanupWorker();
    console.log(`App listening on port ${port}`);
  } catch (error) {
    console.error("Server startup failed:", error);
    await shutdown("STARTUP_FAILURE", 1);
  }
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

startServer();
