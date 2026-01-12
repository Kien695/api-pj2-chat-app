const express = require("express");
const multer = require("multer");
const router = express.Router();
const controller = require("../controller/user.controller");
const validate = require("../validate/auth.validate");
const middleware = require("../middleware/auth.middleware");
const uploadCloud = require("../middleware/uploadCloud.middleware");
const upload = multer();
router.post("/register", validate.authRegister, controller.register);
router.post(
  "/change-password",
  validate.authChangePassword,
  middleware.auth,
  controller.changePassword
);
router.post("/verify", validate.verifyEmail, controller.verifyEmail);
router.post("/login", validate.authLogin, controller.login);
router.post("/logout", middleware.auth, controller.logout);
router.post("/forgot-password", controller.forgotPassword);
router.post(
  "/verifyForgot",
  validate.verifyEmail,
  controller.verifyForgotPassword
);
router.post(
  "/reset-password",
  validate.authResetPassword,
  controller.resetPassword
);
router.post("/refreshToken", controller.refreshToken);
router.get("/getUser", middleware.auth, controller.userDetail);
router.patch(
  "/updateImage",
  upload.single("image"),
  uploadCloud.uploadOne,
  middleware.auth,
  controller.userImage
);
router.patch("/updateUser", middleware.auth, controller.updateUser);
router.get("/getUserFind", middleware.auth, controller.getUser);
router.get("/getAllUser", middleware.auth, controller.getAllStranger);
router.get("/searchUser", middleware.auth, controller.searchUser);
router.get("/getAcceptFriend", middleware.auth, controller.friendInvite);
router.get("/friendList", middleware.auth, controller.friendList);
router.post("/createRoom", middleware.auth, controller.createRoomChat);
router.get("/getRoom", middleware.auth, controller.getRoomChat);
router.patch(
  "/editRoom/:id",
  upload.single("image"),
  uploadCloud.uploadOne,
  middleware.auth,
  controller.editRoomChat
);
router.get("/getAllRoomChat", middleware.auth, controller.getAllRoomChat);
router.patch("/addMember/:id", middleware.auth, controller.addMember);
router.patch("/removeMember/:id", middleware.auth, controller.removeMember);
router.patch("/leaveGroup/:id", middleware.auth, controller.leaveGroup);
router.delete(
  "/removeRoom/:roomChatId",
  middleware.auth,
  controller.removeRoom
);
module.exports = router;
