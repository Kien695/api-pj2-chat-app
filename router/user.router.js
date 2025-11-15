const express = require("express");
const router = express.Router();
const controller = require("../controller/user.controller");
const validate = require("../validate/auth.validate");
const middleware = require("../middleware/auth.middleware");
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
module.exports = router;
