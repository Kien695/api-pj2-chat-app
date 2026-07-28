const express = require("express");
const router = express.Router();
const passport = require("passport");
const middleware = require("../middleware/auth.middleware");
const controller = require("../controller/auth.controller");
require("../config/passport");

//oauth20
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] }),
);
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    session: false,
  }),
  controller.login,
);
//qr
router.post("/qr/create", controller.createQr);
router.post("/qr/scan", middleware.auth, controller.scanQR);
router.post("/qr/confirm", controller.confirm);
module.exports = router;
