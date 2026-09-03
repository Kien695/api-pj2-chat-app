const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const readClient = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "../../chat-app", relativePath), "utf8");

test("client requests notification permission only from an explicit enable action", () => {
  const utility = readClient("src/utils/pushNotification.js");
  const setting = readClient("src/Components/PushNotificationSetting/index.jsx");

  assert.match(utility, /export const enablePushNotifications = async/);
  assert.match(utility, /Notification\.requestPermission\(\)/);
  assert.match(setting, /await enablePushNotifications\(\)/);
  assert.doesNotMatch(readClient("src/App.jsx"), /Notification\.requestPermission/);
});

test("client registers a root-scoped worker and sends a stable device subscription", () => {
  const source = readClient("src/utils/pushNotification.js");
  assert.match(source, /window\.isSecureContext/);
  assert.match(source, /serviceWorker\.register\("\/push-worker\.js", \{ scope: "\/" \}\)/);
  assert.match(source, /applicationServerKey: base64UrlToUint8Array\(vapidPublicKey\)/);
  assert.match(source, /deviceId: getOrCreateDeviceId\(\)/);
  assert.match(source, /postData\("\/auth\/push-subscriptions"/);
  assert.match(source, /deleteData\(`\/auth\/push-subscriptions\/\$\{subscriptionId\}`\)/);
  assert.match(source, /createdSubscription/);
  assert.match(source, /await subscription\.unsubscribe\(\)\.catch/);
  assert.match(source, /finally \{/);
});

test("client hides configuration details and documents public VAPID configuration", () => {
  const utility = readClient("src/utils/pushNotification.js");
  const setting = readClient("src/Components/PushNotificationSetting/index.jsx");
  const clientEnvironment = readClient(".env.example");
  const serverEnvironment = fs.readFileSync(path.join(__dirname, "../.env.example"), "utf8");

  assert.match(utility, /VITE_VAPID_PUBLIC_KEY is missing/);
  assert.match(utility, /Thông báo hiện chưa được cấu hình/);
  assert.match(setting, /error\.userMessage/);
  assert.doesNotMatch(setting, /error\.message/);
  assert.match(clientEnvironment, /^VITE_VAPID_PUBLIC_KEY=/m);
  assert.match(serverEnvironment, /^PUSH_VAPID_SUBJECT=/m);
  assert.match(serverEnvironment, /^PUSH_VAPID_PUBLIC_KEY=/m);
  assert.match(serverEnvironment, /^PUSH_VAPID_PRIVATE_KEY=/m);
  assert.doesNotMatch(serverEnvironment, /^PUSH_VAPID_PRIVATE_KEY=.+/m);
});

test("service worker accepts only same-origin navigation targets", () => {
  const worker = readClient("public/push-worker.js");
  assert.match(worker, /payload\.url\.startsWith\("\/"\)/);
  assert.match(worker, /targetUrl\.origin !== self\.location\.origin/);
  assert.match(worker, /self\.registration\.showNotification/);
  assert.match(worker, /self\.clients\.openWindow/);
});
