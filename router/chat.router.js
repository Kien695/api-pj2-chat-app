const express = require("express");
const router = express.Router();
const controller = require("../controller/chat.controller");
const middlewareChat = require("../middleware/chat.middleware");
router.get("/:roomChatId", middlewareChat.isAccess, controller.index);
module.exports = router;
