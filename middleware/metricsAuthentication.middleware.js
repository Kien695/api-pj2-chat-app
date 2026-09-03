const crypto = require("crypto");

const authenticateMetrics = (req, res, next) => {
  const expected = process.env.METRICS_TOKEN;
  if (typeof expected !== "string" || expected.length < 24) {
    return res.status(404).end();
  }
  const header = req.headers?.authorization;
  const supplied = typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice(7)
    : "";
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const suppliedHash = crypto.createHash("sha256").update(supplied).digest();
  if (!crypto.timingSafeEqual(expectedHash, suppliedHash)) {
    return res.status(401).end();
  }
  return next();
};

module.exports = { authenticateMetrics };
