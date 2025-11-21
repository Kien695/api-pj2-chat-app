const express = require("express");
const router = express.Router();
const controller = require("../controller/chat.controller");
const middleware = require("../middleware/auth.middleware");
router.get("/", middleware.auth, controller.index);
module.exports = router;
