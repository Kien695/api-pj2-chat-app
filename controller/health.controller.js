const { checkReadiness } = require("../service/healthCheck.service");
const { getWorkerHealth } = require("../service/workerHealth.service");

module.exports.live = (_req, res) => res.status(200).json({
  status: "ok",
});

module.exports.ready = async (_req, res) => {
  const result = await checkReadiness();
  return res.status(result.ready ? 200 : 503).json({
    status: result.ready ? "ready" : "not_ready",
    checks: result.checks,
    workers: getWorkerHealth(),
  });
};
