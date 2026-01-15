const jwt = require("jsonwebtoken");

module.exports.auth = (req, res, next) => {
  try {
    let token =
      req.cookies?.accessToken ||
      req.headers?.authorization?.split(" ")[1] ||
      req.query?.token;

    if (!token) {
      return res.status(401).json({
        error: true,
        success: false,
        message: "Chưa đăng nhập",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_TOKEN);

    res.locals.userId = decoded.id;
    next();
  } catch (error) {
    //  BẮT RIÊNG TOKEN HẾT HẠN
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: true,
        success: false,
        message: "Token đã hết hạn",
        expired: true,
      });
    }

    // token sai / bị sửa
    return res.status(401).json({
      error: true,
      success: false,
      message: "Token không hợp lệ",
    });
  }
};
