const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(authorization|cookie|token|password|secret|otp|sessionid|subscriber|ipaddress|^ip$)/i;

const sanitizeLogValue = (value, key = "", depth = 0) => {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (depth > 4) return "[TRUNCATED]";
  if (value instanceof Error) {
    return { name: value.name, code: value.code };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogValue(item, key, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([childKey, childValue]) => [
          childKey,
          sanitizeLogValue(childValue, childKey, depth + 1),
        ]),
    );
  }
  if (typeof value === "string") return value.replace(/[\r\n]/g, " ").slice(0, 1_024);
  return value;
};

const writeLog = (level, event, context = {}, output = console) => {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: String(event).slice(0, 128),
    ...sanitizeLogValue(context),
  });
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "info";
  output[method](entry);
};

module.exports = {
  REDACTED,
  sanitizeLogValue,
  writeLog,
};
