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
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Email không đúng định dạng!",
    });
  }
  const passwordRegex =
    /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[{\]};:'",.<>/?\\|]).{8,}$/;

  if (!passwordRegex.test(password)) {
    return res.status(400).json({
      error: true,
      success: false,
      message:
        "Mật khẩu phải có ít nhất 8 ký tự, gồm 1 chữ hoa, 1 số và 1 ký tự đặc biệt!",
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
const passwordResetEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordResetPasswordRegex =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=[\]{};:'",.<>/?\\|]).{8,128}$/;

//forgot-password
module.exports.authForgotPassword = (req, res, next) => {
  const { email } = req.body;

  if (typeof email !== "string" || !email.trim()) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Vui lòng nhập email",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length > 254 ||
    !passwordResetEmailRegex.test(normalizedEmail)
  ) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Email không đúng định dạng!",
    });
  }

  req.body.email = normalizedEmail;
  next();
};

//verify forgot-password OTP
module.exports.verifyForgotPassword = (req, res, next) => {
  const { email, otp } = req.body;

  if (typeof email !== "string" || typeof otp !== "string") {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Email hoặc mã OTP không hợp lệ",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length > 254 ||
    !passwordResetEmailRegex.test(normalizedEmail) ||
    !/^\d{6}$/.test(otp)
  ) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Email hoặc mã OTP không hợp lệ",
    });
  }

  req.body.email = normalizedEmail;
  next();
};

//reset-password
module.exports.authResetPassword = (req, res, next) => {
  const { resetTicket, newPassword, confirmPassword } = req.body;

  if (
    typeof resetTicket !== "string" ||
    typeof newPassword !== "string" ||
    typeof confirmPassword !== "string"
  ) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Vui lòng nhập đầy đủ thông tin",
    });
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(resetTicket)) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Phiên đặt lại mật khẩu không hợp lệ",
    });
  }

  if (!passwordResetPasswordRegex.test(newPassword)) {
    return res.status(400).json({
      error: true,
      success: false,
      message:
        "Mật khẩu phải có từ 8 đến 128 ký tự, gồm 1 chữ hoa, 1 số và 1 ký tự đặc biệt",
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      error: true,
      success: false,
      message: "Mật khẩu mới và xác nhận mật khẩu không trùng khớp",
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
  const passwordRegex =
    /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=\[{\]};:'",.<>/?\\|]).{8,}$/;

  if (!passwordRegex.test(passwordNew)) {
    return res.status(400).json({
      error: true,
      success: false,
      message:
        "Mật khẩu phải có ít nhất 8 ký tự, gồm 1 chữ hoa, 1 số và 1 ký tự đặc biệt",
    });
  }
  next();
};
