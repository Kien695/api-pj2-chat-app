const HTTP_DURATION_BUCKETS_MS = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000];
const httpRequests = new Map();
const httpDurations = new Map();
const counters = new Map();
let activeSockets = 0;

const incrementMap = (map, key, value = 1) => map.set(key, (map.get(key) || 0) + value);

const observeHttpRequest = ({ method, statusCode, durationMs }) => {
  const safeMethod = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(method)
    ? method
    : "OTHER";
  const statusClass = Number.isInteger(statusCode)
    ? `${Math.floor(statusCode / 100)}xx`
    : "unknown";
  const key = `${safeMethod}|${statusClass}`;
  incrementMap(httpRequests, key);
  const duration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  const current = httpDurations.get(key) || {
    count: 0,
    sum: 0,
    buckets: HTTP_DURATION_BUCKETS_MS.map(() => 0),
  };
  current.count += 1;
  current.sum += duration;
  HTTP_DURATION_BUCKETS_MS.forEach((bucket, index) => {
    if (duration <= bucket) current.buckets[index] += 1;
  });
  httpDurations.set(key, current);
};

const changeActiveSockets = (delta) => {
  activeSockets = Math.max(0, activeSockets + delta);
};

const recordWorkerMetric = (name, succeeded) => {
  const safeName = String(name).replace(/[^a-z0-9_]/gi, "_").slice(0, 64);
  incrementMap(counters, `worker_runs_total|${safeName}|${succeeded ? "success" : "failure"}`);
};

const renderPrometheusMetrics = () => {
  const lines = [
    "# HELP chat_active_sockets Current Socket.IO connections.",
    "# TYPE chat_active_sockets gauge",
    `chat_active_sockets ${activeSockets}`,
    "# HELP chat_http_requests_total Completed HTTP requests.",
    "# TYPE chat_http_requests_total counter",
  ];
  for (const [key, value] of httpRequests) {
    const [method, statusClass] = key.split("|");
    lines.push(`chat_http_requests_total{method="${method}",status_class="${statusClass}"} ${value}`);
  }
  lines.push(
    "# HELP chat_http_request_duration_ms HTTP request duration in milliseconds.",
    "# TYPE chat_http_request_duration_ms histogram",
  );
  for (const [key, value] of httpDurations) {
    const [method, statusClass] = key.split("|");
    const labels = `method="${method}",status_class="${statusClass}"`;
    value.buckets.forEach((count, index) => {
      lines.push(`chat_http_request_duration_ms_bucket{${labels},le="${HTTP_DURATION_BUCKETS_MS[index]}"} ${count}`);
    });
    lines.push(`chat_http_request_duration_ms_bucket{${labels},le="+Inf"} ${value.count}`);
    lines.push(`chat_http_request_duration_ms_sum{${labels}} ${value.sum}`);
    lines.push(`chat_http_request_duration_ms_count{${labels}} ${value.count}`);
  }
  lines.push(
    "# HELP chat_worker_runs_total Background worker runs.",
    "# TYPE chat_worker_runs_total counter",
  );
  for (const [key, value] of counters) {
    const [, worker, outcome] = key.split("|");
    lines.push(`chat_worker_runs_total{worker="${worker}",outcome="${outcome}"} ${value}`);
  }
  return `${lines.join("\n")}\n`;
};

const resetRuntimeMetrics = () => {
  httpRequests.clear();
  httpDurations.clear();
  counters.clear();
  activeSockets = 0;
};

module.exports = {
  changeActiveSockets,
  observeHttpRequest,
  recordWorkerMetric,
  renderPrometheusMetrics,
  resetRuntimeMetrics,
};
