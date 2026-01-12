//register
module.exports.authRegister = (req, res, next) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin",
    });
  }
  next();
};
//verify
module.exports.verifyEmail = (req, res, next) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin",
    });
  }
  next();
};
//login
module.exports.authLogin = (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin",
    });
  }
  next();
};
//reset-password
module.exports.authResetPassword = (req, res, next) => {
  const { email, newPassword, confirmPassword } = req.body;
  if (!email || !newPassword || !confirmPassword) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin",
    });
  }
  next();
};
//change-password
module.exports.authChangePassword = (req, res, next) => {
  const { passwordOld, passwordNew, confirmPasswordNew } = req.body;
  if (!passwordOld || !passwordNew || !confirmPasswordNew) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin",
    });
  }
  next();
};
