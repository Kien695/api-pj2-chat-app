const jwt = require("jsonwebtoken");
module.exports.auth = async (req, res, next) => {
  try {
    let token =
      req.cookies.accessToken || req?.headers?.authorization?.split(" ")[1];

    if (!token) {
      token = req.query.token;
    }
    const decode = jwt.verify(token, process.env.JWT_ACCESS_TOKEN);
    if (!decode) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Token không hợp lệ",
      });
    } else {
      res.locals.userId = decode.id;
      next();
    }
  } catch (error) {
    return res.status(500).json({
      error: true,
      success: false,
      message: "Vui lòng đăng nhập!",
    });
  }
};
