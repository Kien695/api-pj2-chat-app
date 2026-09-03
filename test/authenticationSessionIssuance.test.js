const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const {
  issueAuthenticationSession,
  sessionMetadataFromRequest,
} = require("../service/authenticationSessionIssuance.service");
const { hashSessionSecret } = require("../service/authSession.service");

const userId = new mongoose.Types.ObjectId().toString();
const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const accessSecret = "access-session-test-secret-that-is-long-enough";
const refreshSecret = "refresh-session-test-secret-that-is-long-enough";

test("issues access and refresh tokens bound to one persisted session", async () => {
  const previousAccessSecret = process.env.JWT_ACCESS_TOKEN;
  process.env.JWT_ACCESS_TOKEN = accessSecret;
  let sessionRecord;
  let legacyHash;
  const sessionModel = {
    create: async (record) => { sessionRecord = record; return record; },
    updateOne: async () => ({ modifiedCount: 1 }),
  };
  const userModel = {
    updateOne: async (_filter, update) => {
      legacyHash = update.$set.refresh_token;
      return { matchedCount: 1 };
    },
  };

  try {
    const result = await issueAuthenticationSession(
      { userId, metadata: { loginMethod: "password", deviceInfo: "Chrome" } },
      {
        userModel,
        sessionModel,
        randomUUID: () => sessionId,
        refreshSecret,
        now: new Date("2026-09-03T00:00:00.000Z"),
      },
    );
    const access = jwt.verify(result.accessToken, accessSecret, { algorithms: ["HS256"] });
    const refresh = jwt.verify(result.refreshToken, refreshSecret, { algorithms: ["HS256"] });
    assert.equal(access.sid, sessionId);
    assert.equal(refresh.sid, sessionId);
    assert.equal(result.sessionId, sessionId);
    assert.equal(sessionRecord.sessionId, sessionId);
    assert.equal(sessionRecord.refreshTokenHash, hashSessionSecret(result.refreshToken));
    assert.equal(legacyHash, hashSessionSecret(result.refreshToken));
  } finally {
    if (previousAccessSecret === undefined) delete process.env.JWT_ACCESS_TOKEN;
    else process.env.JWT_ACCESS_TOKEN = previousAccessSecret;
  }
});

test("revokes the new session when the compatibility write fails", async () => {
  const previousAccessSecret = process.env.JWT_ACCESS_TOKEN;
  process.env.JWT_ACCESS_TOKEN = accessSecret;
  let revokeWrite;
  const sessionModel = {
    create: async (record) => record,
    updateOne: async (filter, update) => { revokeWrite = { filter, update }; return { modifiedCount: 1 }; },
  };
  try {
    await assert.rejects(
      issueAuthenticationSession(
        { userId },
        {
          userModel: { updateOne: async () => ({ matchedCount: 0 }) },
          sessionModel,
          randomUUID: () => sessionId,
          refreshSecret,
        },
      ),
      /User not found/,
    );
    assert.equal(revokeWrite.filter.sessionId, sessionId);
    assert.equal(revokeWrite.update.$set.revokeReason, "issuance_failed");
  } finally {
    if (previousAccessSecret === undefined) delete process.env.JWT_ACCESS_TOKEN;
    else process.env.JWT_ACCESS_TOKEN = previousAccessSecret;
  }
});

test("derives session metadata from the request", () => {
  assert.deepEqual(
    sessionMetadataFromRequest(
      {
        body: { deviceId: "123e4567-e89b-42d3-a456-426614174001" },
        headers: { "user-agent": "Browser" },
        ip: "127.0.0.1",
      },
      "passkey",
    ),
    {
      deviceId: "123e4567-e89b-42d3-a456-426614174001",
      deviceInfo: "Browser",
      loginMethod: "passkey",
      ipAddress: "127.0.0.1",
    },
  );
});

test("all interactive login completions use session issuance", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const userController = fs.readFileSync(path.join(__dirname, "../controller/user.controller.js"), "utf8");
  const authController = fs.readFileSync(path.join(__dirname, "../controller/auth.controller.js"), "utf8");
  assert.equal((userController.match(/issueAuthenticationSession\(/g) || []).length, 2);
  assert.equal((authController.match(/issueAuthenticationSession\(/g) || []).length, 2);
});
