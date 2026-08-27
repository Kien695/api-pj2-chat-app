const express = require("express");
const router = express.Router();
const passport = require("passport");
const middleware = require("../middleware/auth.middleware");
const controller = require("../controller/auth.controller");
const { authRateLimit } = require("../middleware/rateLimit.middleware");
require("../config/passport");

//oauth20
router.get(
  "/google",
  authRateLimit("oauthStart"),
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
router.post("/oauth/exchange", authRateLimit("oauthExchange"), controller.exchangeOAuthCode);
//qr
router.post("/qr/create", authRateLimit("qrCreate"), controller.createQr);
router.post("/qr/scan", authRateLimit("qrAction"), middleware.auth, controller.scanQR);
router.post("/qr/confirm", authRateLimit("qrAction"), middleware.auth, controller.confirm);
router.post("/qr/cancel", authRateLimit("qrAction"), middleware.auth, controller.cancelQR);
module.exports = router;
