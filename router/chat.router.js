const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 10MB
});
const controller = require("../controller/chat.controller");
const middlewareChat = require("../middleware/chat.middleware");
const cloudinary = require("../middleware/uploadCloud.middleware");
router.get("/:roomChatId", middlewareChat.isAccess, controller.index);
router.post(
  "/:roomChatId",
  upload.array("files"),
  cloudinary.uploadFile,
  controller.create
);
module.exports = router;
