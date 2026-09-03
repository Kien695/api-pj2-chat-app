const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("logout revokes only the client-provided subscription owned by that user", () => {
  const controller = fs.readFileSync(path.join(__dirname, "../controller/user.controller.js"), "utf8");
  const clientFiles = [
    "src/Components/Setting/index.jsx",
    "src/Components/SidebarUser/index.jsx",
  ].map((file) => fs.readFileSync(path.join(__dirname, "../../chat-app", file), "utf8"));

  assert.match(controller, /removePushSubscriptionForLogout\(\{\s*userId,\s*subscriptionId: req\.body\?\.pushSubscriptionId/);
  for (const source of clientFiles) {
    assert.match(source, /pushSubscriptionId: getStoredPushSubscriptionId\(\)/);
    assert.match(source, /await clearLocalPushSubscription\(\)\.catch/);
  }
});

test("password reset revokes every push subscription without changing its success result", () => {
  const source = fs.readFileSync(path.join(__dirname, "../controller/user.controller.js"), "utf8");
  const resetStart = source.indexOf("module.exports.resetPassword");
  const refreshStart = source.indexOf("module.exports.refreshToken", resetStart);
  const resetSource = source.slice(resetStart, refreshStart);
  assert.match(resetSource, /await removeAllPushSubscriptions\(user\._id\)/);
  assert.match(resetSource, /pushSubscriptionsRevoked/);
  assert.match(resetSource, /sessionsRevoked: true/);
  assert.match(resetSource, /await revokeAllAuthSessions\(\{/);
  assert.match(resetSource, /getIO\(\)\.in\(user\._id\.toString\(\)\)\.disconnectSockets\(true\)/);
});

test("logout revokes only the authenticated session with a legacy fallback", () => {
  const source = fs.readFileSync(path.join(__dirname, "../controller/user.controller.js"), "utf8");
  const logoutStart = source.indexOf("module.exports.logout");
  const logoutEnd = source.indexOf("module.exports.updateProfile", logoutStart);
  const logoutSource = source.slice(logoutStart, logoutEnd);
  assert.match(logoutSource, /const sessionId = res\.locals\.sessionId/);
  assert.match(logoutSource, /await revokeAuthSession\(\{ userId, sessionId, reason: "logout" \}\)/);
  assert.match(logoutSource, /else \{[\s\S]*refresh_token: ""/);
});
