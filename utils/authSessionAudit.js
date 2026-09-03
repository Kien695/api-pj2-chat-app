const writeAuthSessionAudit = (event, details = {}) => {
  console.info(JSON.stringify({
    category: "auth_session",
    event,
    outcome: details.outcome || "success",
    userId: details.userId ? String(details.userId) : undefined,
    sessionId: details.sessionId,
    affectedCount: details.affectedCount,
    timestamp: new Date().toISOString(),
  }));
};

module.exports = { writeAuthSessionAudit };
