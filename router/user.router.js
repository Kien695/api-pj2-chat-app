const express = require("express");
const router = express.Router();
const controller = require("../controller/user.controller");
const roomController = require("../controller/room.controller");
const validate = require("../validate/auth.validate");
const middleware = require("../middleware/auth.middleware");
const middlewareChat = require("../middleware/chat.middleware");
const {
  authRateLimit,
  restRateLimit,
} = require("../middleware/rateLimit.middleware");
const uploadCloud = require("../middleware/uploadCloud.middleware");
const {
  profileImageUpload,
} = require("../middleware/uploadLimits.middleware");
const {
  requireProfileImageUpload,
  validateProfileImageUpload,
} = require("../middleware/validateUpload.middleware");
const {
  validateAddMembers,
  validateCreateRoom,
  validateRemoveMember,
  validateRoomEdit,
  validateUserSearch,
} = require("../middleware/restInputValidation.middleware");
router.post("/register", authRateLimit("register"), validate.authRegister, controller.register);
router.post(
  "/change-password",
  authRateLimit("changePassword"),
  validate.authChangePassword,
  middleware.auth,
  controller.changePassword,
);
router.post("/verify", authRateLimit("verifyEmail"), validate.verifyEmail, controller.verifyEmail);
router.post("/login", authRateLimit("login"), validate.authLogin, controller.login);
router.post("/logout", middleware.auth, controller.logout);
router.post(
  "/forgot-password",
  authRateLimit("forgotPassword"),
  validate.authForgotPassword,
  controller.forgotPassword,
);
router.post(
  "/verifyForgot",
  authRateLimit("verifyForgotPassword"),
  validate.verifyForgotPassword,
  controller.verifyForgotPassword,
);
router.post(
  "/reset-password",
  authRateLimit("resetPassword"),
  validate.authResetPassword,
  controller.resetPassword,
);
router.post("/refreshToken", authRateLimit("refreshToken"), controller.refreshToken);

router.post(
  "/passkey/register/options",
  authRateLimit("passkey"),
  middleware.auth,
  controller.passkeyRegisterOptions,
);
router.post(
  "/passkey/register/verify",
  authRateLimit("passkey"),
  middleware.auth,
  controller.passkeyRegisterVerify,
);
router.post("/passkey/login/options", authRateLimit("passkey"), controller.passkeyLoginOptions);
router.post("/passkey/login/verify", authRateLimit("passkey"), controller.passkeyLoginVerify);

router.delete("/passkey/delete", middleware.auth, controller.deletePasskey);

router.get("/getUser", middleware.auth, controller.userDetail);
router.patch(
  "/updateImage",
  middleware.auth,
  restRateLimit("profileUpload"),
  profileImageUpload,
  requireProfileImageUpload,
  uploadCloud.uploadOne,
  controller.userImage,
);
router.patch("/updateUser", middleware.auth, controller.updateUser);
router.get("/getUserFind", middleware.auth, validateUserSearch, controller.getUser);
router.get("/getAllUser", middleware.auth, controller.getAllStranger);
router.get(
  "/searchUser",
  middleware.auth,
  restRateLimit("userSearch"),
  validateUserSearch,
  controller.searchUser,
);
router.get("/getAcceptFriend", middleware.auth, controller.friendInvite);
router.get("/friendList", middleware.auth, controller.friendList);
router.post(
  "/createRoom",
  middleware.auth,
  restRateLimit("roomCreate"),
  validateCreateRoom,
  roomController.createRoomChat,
);
router.get("/getRoom", middleware.auth, roomController.getRoomChat);
router.patch(
  "/editRoom/:id",
  middleware.auth,
  middlewareChat.isGroupAdmin,
  restRateLimit("roomMutation"),
  profileImageUpload,
  validateRoomEdit,
  validateProfileImageUpload,
  uploadCloud.uploadOne,
  roomController.editRoomChat,
);
router.get("/getAllRoomChat", middleware.auth, roomController.getAllRoomChat);
router.patch(
  "/addMember/:id",
  middleware.auth,
  middlewareChat.isGroupAdmin,
  restRateLimit("roomMutation"),
  validateAddMembers,
  roomController.addMember,
);
router.patch(
  "/removeMember/:id",
  middleware.auth,
  middlewareChat.isGroupAdmin,
  restRateLimit("roomMutation"),
  validateRemoveMember,
  roomController.removeMember,
);
router.patch(
  "/leaveGroup/:id",
  middleware.auth,
  middlewareChat.isAccess,
  restRateLimit("roomMutation"),
  roomController.leaveGroup,
);
router.delete(
  "/removeRoom/:roomChatId",
  middleware.auth,
  middlewareChat.isGroupAdmin,
  restRateLimit("roomMutation"),
  roomController.removeRoom,
);
module.exports = router;
