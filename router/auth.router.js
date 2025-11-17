const express = require("express");
const router = express.Router();
const passport = require("passport");
const middleware = require("../middleware/auth.middleware");
const controller = require("../controller/auth20.controller");
require("../config/passport");
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login",
    session: false,
  }),
  controller.login
);

module.exports = router;
