const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const {
  requireCallPermission,
  validateCallAction,
  validateCallRequest,
  validateCallResponse,
} = require("../service/callSignalingSecurity.service");

const callerId = new mongoose.Types.ObjectId().toString();
const calleeId = new mongoose.Types.ObjectId().toString();
const callId = "123e4567-e89b-42d3-a456-426614174000";

test("derives only target, signal and type from a call request", () => {
  assert.deepEqual(validateCallRequest({
    callToUserId: calleeId,
    signalData: { type: "offer", sdp: "safe" },
    type: "video",
    from: "spoofed-user",
    name: "spoofed-name",
  }, callerId), {
    calleeId,
    signal: { type: "offer", sdp: "safe" },
    type: "video",
  });
});

test("rejects self calls, invalid types, and oversized signaling", () => {
  assert.throws(() => validateCallRequest({
    callToUserId: callerId, signalData: { sdp: "x" }, type: "video",
  }, callerId), (error) => error.code === "SELF_CALL_NOT_ALLOWED");
  assert.throws(() => validateCallRequest({
    callToUserId: calleeId, signalData: { sdp: "x" }, type: "admin",
  }, callerId), (error) => error.code === "INVALID_CALL_TYPE");
  assert.throws(() => validateCallRequest({
    callToUserId: calleeId, signalData: { sdp: "x".repeat(256 * 1024) }, type: "audio",
  }, callerId), (error) => error.code === "CALL_SIGNAL_TOO_LARGE");
});

test("validates answer and call-state action identifiers", () => {
  assert.deepEqual(validateCallResponse({ callId, signal: { type: "answer" } }), {
    callId, signal: { type: "answer" },
  });
  assert.equal(validateCallAction({ callId }), callId);
  assert.throws(() => validateCallAction({ callId: "caller-user-id" }));
});

test("allows calls only when a private friend room exists", async () => {
  await requireCallPermission(callerId, calleeId, { exists: async () => ({ _id: "room" }) });
  await assert.rejects(
    requireCallPermission(callerId, calleeId, { exists: async () => null }),
    (error) => error.code === "CALL_PERMISSION_DENIED" && error.status === 403,
  );
});
