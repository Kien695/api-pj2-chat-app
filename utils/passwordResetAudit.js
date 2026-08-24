const crypto = require("crypto");

const getEmailFingerprint = (email) =>
  crypto
    .createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);

const writePasswordResetAudit = (req, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    category: "password_reset",
    event,
    ip: req.ip,
    userAgent: req.get?.("user-agent")?.slice(0, 256) || "unknown",
    ...details,
  };

  console.info(`[AUDIT] ${JSON.stringify(entry)}`);
};

module.exports = { getEmailFingerprint, writePasswordResetAudit };
