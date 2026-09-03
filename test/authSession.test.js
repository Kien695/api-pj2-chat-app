const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const AuthSession = require("../model/auth-session.model");
const {
  createAuthSession,
  findActiveSession,
  hashSessionSecret,
  normalizeSessionMetadata,
  revokeAllAuthSessions,
  revokeAuthSession,
  listActiveAuthSessions,
  revokeOtherAuthSession,
  revokeOtherAuthSessions,
} = require("../service/authSession.service");

const userId = new mongoose.Types.ObjectId().toString();
const sessionId = "123e4567-e89b-42d3-a456-426614174000";

test("auth session schema has unique identity, lookup and TTL indexes", () => {
  const indexes = AuthSession.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.sessionId === 1 && options.unique === true));
  assert.ok(indexes.some(([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0));
  assert.ok(indexes.some(([keys]) => keys.userId === 1 && keys.revokedAt === 1 && keys.expiresAt === -1));
});

test("creates a bounded session and stores hashes instead of secrets", async () => {
  const now = new Date("2026-09-03T00:00:00.000Z");
  let record;
  const model = { create: async (value) => { record = value; return value; } };
  await createAuthSession({
    userId,
    sessionId,
    refreshToken: "plain-refresh-token",
    expiresAt: new Date(now.getTime() + 60_000),
    metadata: {
      deviceId: "123e4567-e89b-42d3-a456-426614174001",
      deviceInfo: `  Browser ${"x".repeat(300)}  `,
      loginMethod: "password",
      ipAddress: "127.0.0.1",
    },
  }, model, now);

  assert.equal(record.refreshTokenHash, hashSessionSecret("plain-refresh-token"));
  assert.notEqual(record.refreshTokenHash, "plain-refresh-token");
  assert.equal(record.ipHash, hashSessionSecret("127.0.0.1"));
  assert.notEqual(record.ipHash, "127.0.0.1");
  assert.equal(record.deviceInfo.length, 256);
  assert.equal(record.loginMethod, "password");
});

test("active lookup excludes revoked and expired sessions", async () => {
  const now = new Date("2026-09-03T00:00:00.000Z");
  let filter;
  const model = { findOne: async (value) => { filter = value; return null; } };
  await findActiveSession({ userId, sessionId }, model, now);
  assert.equal(filter.revokedAt, null);
  assert.deepEqual(filter.expiresAt, { $gt: now });
});

test("revokes one session or every active user session without deleting audit data", async () => {
  const writes = [];
  const model = {
    updateOne: async (filter, update) => { writes.push({ filter, update }); return { modifiedCount: 1 }; },
    updateMany: async (filter, update) => { writes.push({ filter, update }); return { modifiedCount: 2 }; },
  };
  await revokeAuthSession({ userId, sessionId, reason: "logout" }, model);
  await revokeAllAuthSessions({ userId, reason: "password_reset" }, model);
  assert.equal(writes[0].filter.sessionId, sessionId);
  assert.equal(writes[0].update.$set.revokeReason, "logout");
  assert.deepEqual(writes[1].filter, { userId, revokedAt: null });
  assert.equal(writes[1].update.$set.revokeReason, "password_reset");
});

test("rejects malformed identity, secret, device and expiry before database access", async () => {
  assert.throws(() => hashSessionSecret(""), (error) => error.code === "INVALID_SESSION_SECRET");
  assert.throws(
    () => normalizeSessionMetadata({ deviceId: "browser" }),
    (error) => error.code === "INVALID_DEVICE_ID",
  );
  await assert.rejects(
    createAuthSession({ userId, sessionId, refreshToken: "token", expiresAt: new Date(0) }),
    (error) => error.code === "INVALID_SESSION_EXPIRY",
  );
});

test("lists only safe active-session fields and identifies the current device", async () => {
  const now = new Date("2026-09-03T00:00:00.000Z");
  let filter;
  let projection;
  const records = [{
    sessionId,
    deviceId: null,
    deviceInfo: "Chrome",
    loginMethod: "password",
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    refreshTokenHash: "must-not-leak",
    ipHash: "must-not-leak",
  }];
  const query = {
    select(value) { projection = value; return this; },
    sort() { return this; },
    lean: async () => records,
  };
  const result = await listActiveAuthSessions(
    { userId, currentSessionId: sessionId.toUpperCase() },
    { find: (value) => { filter = value; return query; } },
    now,
  );
  assert.equal(filter.revokedAt, null);
  assert.match(projection, /sessionId/);
  assert.doesNotMatch(projection, /refreshTokenHash|ipHash/);
  assert.equal(result[0].current, true);
  assert.equal("refreshTokenHash" in result[0], false);
  assert.equal("ipHash" in result[0], false);
});

test("revokes only another session owned by the authenticated user", async () => {
  const targetSessionId = "123e4567-e89b-42d3-a456-426614174001";
  let write;
  const model = {
    updateOne: async (filter, update) => {
      write = { filter, update };
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  assert.equal(
    await revokeOtherAuthSession({ userId, currentSessionId: sessionId, targetSessionId }, model),
    true,
  );
  assert.equal(write.filter.userId, userId);
  assert.equal(write.filter.sessionId, targetSessionId);
  assert.equal(write.update.$set.revokeReason, "remote_logout");
  await assert.rejects(
    revokeOtherAuthSession({ userId, currentSessionId: sessionId, targetSessionId: sessionId }, model),
    (error) => error.code === "CURRENT_SESSION_REQUIRES_LOGOUT" && error.status === 409,
  );
});

test("revokes all other active sessions while preserving the current session", async () => {
  let write;
  const model = {
    updateMany: async (filter, update) => {
      write = { filter, update };
      return { modifiedCount: 3 };
    },
  };
  const count = await revokeOtherAuthSessions({ userId, currentSessionId: sessionId }, model);
  assert.equal(count, 3);
  assert.deepEqual(write.filter.sessionId, { $ne: sessionId });
  assert.equal(write.filter.userId, userId);
  assert.equal(write.filter.revokedAt, null);
  assert.equal(write.update.$set.revokeReason, "remote_logout_all");
});

test("session management routes require auth and rate limiting", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../router/user.router.js"), "utf8");
  assert.match(source, /router\.get\(\s*"\/sessions",\s*middleware\.auth,\s*restRateLimit\("sessionManagement"\)/);
  assert.match(source, /router\.delete\(\s*"\/sessions\/others",\s*middleware\.auth/);
  assert.match(source, /router\.delete\(\s*"\/sessions\/:sessionId",\s*middleware\.auth/);
});

test("device settings client loads and revokes only through session APIs", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(
    path.join(__dirname, "../../chat-app/src/Components/DeviceSessionSetting/index.jsx"),
    "utf8",
  );
  assert.match(source, /getData\("\/auth\/sessions"\)/);
  assert.match(source, /deleteData\(`\/auth\/sessions\/\$\{encodeURIComponent\(sessionId\)\}`\)/);
  assert.match(source, /deleteData\("\/auth\/sessions\/others"\)/);
  assert.doesNotMatch(source, /refreshTokenHash|ipHash/);
});

test("session revocation disconnects matching sockets, cleans push and writes audit events", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const controller = fs.readFileSync(
    path.join(__dirname, "../controller/authSession.controller.js"),
    "utf8",
  );
  const socket = fs.readFileSync(path.join(__dirname, "../socket/index.js"), "utf8");
  assert.match(controller, /removePushSubscriptionsForSessions/);
  assert.match(controller, /disconnectSockets\(true\)/);
  assert.match(controller, /writeAuthSessionAudit\("remote_logout/);
  assert.match(socket, /socket\.join\(`auth-session:\$\{authSessionId\}`\)/);
});
