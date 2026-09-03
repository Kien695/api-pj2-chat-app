const { randomUUID } = require("crypto");
const { writeLog } = require("../utils/structuredLogger");
const { observeHttpRequest } = require("../service/runtimeMetrics.service");

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const createRequestObservabilityMiddleware = ({
  createId = randomUUID,
  now = Date.now,
  logger = writeLog,
  recordRequest = observeHttpRequest,
} = {}) => (req, res, next) => {
  const suppliedId = req.headers?.["x-request-id"];
  const requestId =
    typeof suppliedId === "string" && REQUEST_ID_PATTERN.test(suppliedId)
      ? suppliedId
      : createId();
  const startedAt = now();
  req.id = requestId;
  res.locals.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);

  res.once("finish", () => {
    const route = String(req.originalUrl || req.url || "/").split("?", 1)[0].slice(0, 256);
    const completion = {
      requestId,
      method: req.method,
      route,
      statusCode: res.statusCode,
      durationMs: Math.max(0, now() - startedAt),
    };
    recordRequest(completion);
    logger("info", "http_request_completed", completion);
  });
  next();
};

module.exports = {
  REQUEST_ID_PATTERN,
  createRequestObservabilityMiddleware,
};
