const express = require("express");
const multer = require("multer");
const router = express.Router();
const controller = require("../controller/user.controller");
const validate = require("../validate/auth.validate");
const middleware = require("../middleware/auth.middleware");
const uploadCloud = require("../middleware/uploadCloud.middleware");
const upload = multer();
router.post("/register", validate.authRegister, controller.register);
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
router.put(
  "/updateImage",
  upload.single("image"),
  uploadCloud.uploadOne,
  middleware.auth,
  controller.userImage
);
router.patch("/updateUser", middleware.auth, controller.updateUser);
router.get("/getAllUser", middleware.auth, controller.getUser);
module.exports = router;
