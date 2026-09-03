const states = new Map();
const { recordWorkerMetric } = require("./runtimeMetrics.service");

const updateWorker = (name, update) => {
  const current = states.get(name) || { name, status: "stopped", failures: 0 };
  states.set(name, { ...current, ...update });
};

const recordWorkerStarted = (name, now = new Date()) => updateWorker(name, {
  status: "running",
  startedAt: now,
});

const recordWorkerRun = (name, succeeded, now = new Date()) => {
  recordWorkerMetric(name, succeeded);
  updateWorker(name, {
    status: succeeded ? "running" : "degraded",
    lastRunAt: now,
    ...(succeeded
      ? { lastSuccessAt: now }
      : { lastFailureAt: now, failures: (states.get(name)?.failures || 0) + 1 }),
  });
};

const recordWorkerStopped = (name, now = new Date()) => updateWorker(name, {
  status: "stopped",
  stoppedAt: now,
});

const getWorkerHealth = () => Array.from(states.values()).map((state) => ({ ...state }));
const resetWorkerHealth = () => states.clear();

module.exports = {
  getWorkerHealth,
  recordWorkerRun,
  recordWorkerStarted,
  recordWorkerStopped,
  resetWorkerHealth,
};
