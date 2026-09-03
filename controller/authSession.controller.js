const {
  AuthSessionError,
  listActiveAuthSessions,
  revokeOtherAuthSession,
  revokeOtherAuthSessions,
} = require("../service/authSession.service");
const {
  removePushSubscriptionsForSessions,
} = require("../service/pushSubscription.service");
const { sendInternalServerError } = require("../utils/httpErrorResponse");
const { writeAuthSessionAudit } = require("../utils/authSessionAudit");
const { getIO } = require("../socket");

const disconnectSessions = (sessionIds) => {
  const io = getIO();
  for (const sessionId of sessionIds) {
    io.in(`auth-session:${sessionId}`).disconnectSockets(true);
  }
};

const cleanupSessionPush = async (userId, sessionIds) => {
  try {
    await removePushSubscriptionsForSessions({ userId, sessionIds });
  } catch (error) {
    console.error("Revoked session push cleanup failed", {
      userId,
      error: error?.message,
    });
  }
};

const sendAuthSessionError = (res, error) => {
  if (!(error instanceof AuthSessionError)) return false;
  res.status(error.status).json({
    success: false,
    error: true,
    code: error.code,
    message: error.message,
  });
  return true;
};

const requireCurrentSession = (res) => {
  if (!res.locals.sessionId) {
    throw new AuthSessionError(
      "SESSION_UPGRADE_REQUIRED",
      "Please sign in again to manage devices",
      409,
    );
  }
  return res.locals.sessionId;
};

module.exports.list = async (_req, res) => {
  try {
    const currentSessionId = requireCurrentSession(res);
    const sessions = await listActiveAuthSessions({
      userId: res.locals.userId,
      currentSessionId,
    });
    return res.status(200).json({ success: true, error: false, data: sessions });
  } catch (error) {
    if (sendAuthSessionError(res, error)) return;
    return sendInternalServerError(res, error, "Auth session listing failed");
  }
};

module.exports.revokeOne = async (req, res) => {
  try {
    const currentSessionId = requireCurrentSession(res);
    await revokeOtherAuthSession({
      userId: res.locals.userId,
      currentSessionId,
      targetSessionId: req.params.sessionId,
    });
    await cleanupSessionPush(res.locals.userId, [req.params.sessionId]);
    disconnectSessions([req.params.sessionId]);
    writeAuthSessionAudit("remote_logout", {
      userId: res.locals.userId,
      sessionId: req.params.sessionId,
    });
    return res.status(200).json({ success: true, error: false });
  } catch (error) {
    if (sendAuthSessionError(res, error)) return;
    return sendInternalServerError(res, error, "Auth session revocation failed");
  }
};

module.exports.revokeOthers = async (_req, res) => {
  try {
    const currentSessionId = requireCurrentSession(res);
    const activeSessions = await listActiveAuthSessions({
      userId: res.locals.userId,
      currentSessionId,
    });
    const targetSessionIds = activeSessions
      .filter((session) => !session.current)
      .map((session) => session.sessionId);
    const revokedCount = await revokeOtherAuthSessions({
      userId: res.locals.userId,
      currentSessionId,
    });
    await cleanupSessionPush(res.locals.userId, targetSessionIds);
    disconnectSessions(targetSessionIds);
    writeAuthSessionAudit("remote_logout_all", {
      userId: res.locals.userId,
      affectedCount: revokedCount,
    });
    return res.status(200).json({
      success: true,
      error: false,
      data: { revokedCount },
    });
  } catch (error) {
    if (sendAuthSessionError(res, error)) return;
    return sendInternalServerError(res, error, "Auth session revocation failed");
  }
};
