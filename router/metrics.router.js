const express = require("express");
const controller = require("../controller/metrics.controller");
const { authenticateMetrics } = require("../middleware/metricsAuthentication.middleware");

const router = express.Router();
router.get("/", authenticateMetrics, controller.getMetrics);

module.exports = router;
