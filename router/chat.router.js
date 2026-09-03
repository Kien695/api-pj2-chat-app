const express = require("express");
const router = express.Router();
const {
  chatImageUpload,
  chatFileUpload,
} = require("../middleware/uploadLimits.middleware");
const {
  validateChatFileUploads,
  validateChatImageUploads,
} = require("../middleware/validateUpload.middleware");
const controller = require("../controller/chat.controller");
const middlewareChat = require("../middleware/chat.middleware");
const { restRateLimit } = require("../middleware/rateLimit.middleware");
const cloudinary = require("../middleware/uploadCloud.middleware");
router.get(
  "/:roomChatId/sync",
  middlewareChat.isAccess,
  restRateLimit("chatSync"),
  controller.sync,
);
router.get("/:roomChatId", middlewareChat.isAccess, controller.index);
router.post(
  "/:roomChatId/images",
  middlewareChat.isAccess,
  restRateLimit("chatUpload"),
  chatImageUpload,
  validateChatImageUploads,
  cloudinary.uploadImages,
  controller.createImages,
);
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
