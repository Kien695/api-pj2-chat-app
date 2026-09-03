const assert = require("node:assert/strict");
const test = require("node:test");
const { authenticateMetrics } = require("../middleware/metricsAuthentication.middleware");
const {
  changeActiveSockets,
  observeHttpRequest,
  recordWorkerMetric,
  renderPrometheusMetrics,
  resetRuntimeMetrics,
} = require("../service/runtimeMetrics.service");

const createResponse = () => ({
  statusCode: null,
  ended: false,
  status(code) {
    this.statusCode = code;
    return this;
  },
  end() {
    this.ended = true;
    return this;
  },
});

test.beforeEach(() => resetRuntimeMetrics());

test("renders bounded HTTP metrics with cumulative duration buckets", () => {
  observeHttpRequest({ method: "GET", statusCode: 200, durationMs: 75 });
  observeHttpRequest({ method: "TRACE-user-id", statusCode: 503, durationMs: 6000 });

  const output = renderPrometheusMetrics();
  assert.match(output, /chat_http_requests_total\{method="GET",status_class="2xx"\} 1/);
  assert.match(output, /chat_http_requests_total\{method="OTHER",status_class="5xx"\} 1/);
  assert.match(output, /chat_http_request_duration_ms_bucket\{method="GET",status_class="2xx",le="50"\} 0/);
  assert.match(output, /chat_http_request_duration_ms_bucket\{method="GET",status_class="2xx",le="100"\} 1/);
  assert.match(output, /chat_http_request_duration_ms_bucket\{method="OTHER",status_class="5xx",le="\+Inf"\} 1/);
  assert.equal(output.includes("TRACE-user-id"), false);
});

test("tracks active sockets without allowing a negative gauge", () => {
  changeActiveSockets(1);
  changeActiveSockets(1);
  changeActiveSockets(-1);
  assert.match(renderPrometheusMetrics(), /chat_active_sockets 1/);

  changeActiveSockets(-10);
  assert.match(renderPrometheusMetrics(), /chat_active_sockets 0/);
});

test("bounds worker metric labels and records outcomes", () => {
  recordWorkerMetric("push worker/primary", true);
  recordWorkerMetric("push worker/primary", false);
  const output = renderPrometheusMetrics();
  assert.match(output, /chat_worker_runs_total\{worker="push_worker_primary",outcome="success"\} 1/);
  assert.match(output, /chat_worker_runs_total\{worker="push_worker_primary",outcome="failure"\} 1/);
});

test("metrics endpoint stays unavailable when no strong token is configured", () => {
  const previous = process.env.METRICS_TOKEN;
  delete process.env.METRICS_TOKEN;
  const res = createResponse();
  let nextCalled = false;
  authenticateMetrics({ headers: {} }, res, () => { nextCalled = true; });
  if (previous === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = previous;

  assert.equal(res.statusCode, 404);
  assert.equal(res.ended, true);
  assert.equal(nextCalled, false);
});

test("metrics endpoint accepts only the configured bearer token", () => {
  const previous = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "a-strong-metrics-token-value";

  const denied = createResponse();
  authenticateMetrics({ headers: { authorization: "Bearer wrong" } }, denied, () => {});
  assert.equal(denied.statusCode, 401);

  const accepted = createResponse();
  let nextCalled = false;
  authenticateMetrics(
    { headers: { authorization: "Bearer a-strong-metrics-token-value" } },
    accepted,
    () => { nextCalled = true; },
  );
  if (previous === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = previous;

  assert.equal(nextCalled, true);
  assert.equal(accepted.statusCode, null);
});
