const {
  renderPrometheusMetrics,
} = require("../service/runtimeMetrics.service");

module.exports.getMetrics = (_req, res) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return res.status(200).send(renderPrometheusMetrics());
};
