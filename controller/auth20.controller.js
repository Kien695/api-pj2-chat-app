const jwt = require("jsonwebtoken");
//login oauth20
module.exports.login = async (req, res) => {
  try {
    const token = jwt.sign(
      { id: req.user.user._id },
      process.env.JWT_ACCESS_TOKEN,
      {
        expiresIn: "7d",
      }
    );
    res.redirect(
      `${process.env.CLIENT_URL}/auth-success?token=${token}&documentId=${req.user.documentId}`
    );
  } catch (error) {
    console.log("Google OAuth Error:", error);
    res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_failed`);
  }
};
