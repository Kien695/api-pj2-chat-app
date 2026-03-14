const jwt = require("jsonwebtoken");
const { generateRefreshToken } = require("../utils/generateRefreshToken");
const { generateAccessToken } = require("../utils/generateAccessToken");
//login oauth20
module.exports.login = async (req, res) => {
  try {
    const accessToken = await generateAccessToken(req.user.user._id);
    const refreshToken = await generateRefreshToken(req.user.user._id);
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    res.redirect(
      `${process.env.CLIENT_URL}/auth-success?token=${accessToken}&documentId=${req.user.documentId}`,
    );
  } catch (error) {
    console.log("Google OAuth Error:", error);
    res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_failed`);
  }
};
