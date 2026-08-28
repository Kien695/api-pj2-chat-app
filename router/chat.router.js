const express = require("express");
const router = express.Router();
const {
  chatFileUpload,
} = require("../middleware/uploadLimits.middleware");
const {
  validateChatFileUploads,
} = require("../middleware/validateUpload.middleware");
const controller = require("../controller/chat.controller");
const middlewareChat = require("../middleware/chat.middleware");
const { restRateLimit } = require("../middleware/rateLimit.middleware");
const cloudinary = require("../middleware/uploadCloud.middleware");
router.get("/:roomChatId", middlewareChat.isAccess, controller.index);
router.post(
  "/:roomChatId",
  middlewareChat.isAccess,
  restRateLimit("chatUpload"),
  chatFileUpload,
  validateChatFileUploads,
  cloudinary.uploadFile,
  controller.create,
);

module.exports = router;
