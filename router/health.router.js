const express = require("express");
const controller = require("../controller/health.controller");

const router = express.Router();

router.get("/live", controller.live);
router.get("/ready", controller.ready);

module.exports = router;
