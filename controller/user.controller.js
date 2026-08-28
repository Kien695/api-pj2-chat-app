const redis = require("../config/redis");
const User = require("../model/user.model");
const Passkey = require("../model/passkey.model");
const bcryptjs = require("bcryptjs");
const { randomUUID } = require("crypto");
const { sendMail } = require("../config/sendMail");
const { generateAccessToken } = require("../utils/generateAccessToken");
const { generateRefreshToken } = require("../utils/generateRefreshToken");
const {
  RefreshTokenError,
  rotateRefreshToken,
} = require("../service/refreshTokenRotation.service");
const {
  clearRefreshCookieOptions,
  refreshCookieOptions,
} = require("../utils/authCookie");
const searchHelper = require("../helper/search");
const { myDocument } = require("../helper/createMyDocument");
const { cleanupAssets } = require("../service/cloudinaryAsset.service");
const { enqueueMediaCleanup } = require("../service/mediaCleanupJob.service");
const { sendInternalServerError } = require("../utils/httpErrorResponse");
const {
  ProfileUpdateValidationError,
  validateProfileUpdate,
} = require("../service/profileUpdateValidation.service");
const {
  PASSWORD_RESET_TTL_SECONDS,
  PASSWORD_RESET_COOLDOWN_SECONDS,
  normalizeEmail,
  getOtpKey,
  getCooldownKey,
  getTicketKey,
  generateOtp,
  hashOtp,
  generateResetTicket,
  verifyOtpChallenge,
  consumeResetTicket,
} = require("../utils/passwordReset");
const {
  getEmailFingerprint,
  writePasswordResetAudit,
} = require("../utils/passwordResetAudit");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
  secure: true,
});
const origin = process.env.CLIENT_ORIGIN;
const rpID = process.env.RP_ID;
const rpName = process.env.RP_NAME;
//register
module.exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user;
    user = await User.findOne({ email: email });
    if (user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email đã tồn tại!",
      });
    }

    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(password, salt);
    user = new User({
      name: name,
      email: email,
      password: hashPassword,
      otp: verifyCode,
      otp_expiry: Date.now() + 600000,
    });
    await user.save();
    //tạo document
    await myDocument(user._id);
    //otp
    const subject = "Mã OTP xác minh";
    const html = `Mã OTP để xác quy Email của bạn là: <b style="color:green">${verifyCode}</b>. Thời hạn sử dụng là: ${Math.ceil(
      600000 / 60000,
    )} phút`;
    const verifyEmail = await sendMail(email, subject, html);

    return res.status(200).json({
      error: false,
      success: true,
      message: "Vui lòng xác minh email của bạn",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//change password
module.exports.changePassword = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const user = await User.findById(userId);
    const { passwordOld, passwordNew, confirmPasswordNew } = req.body;

    if (!user) {
      return res.state(400).json({
        message: "Người dùng không tồn tại",
        error: true,
        success: false,
      });
    }
    const isMatch = await bcryptjs.compare(passwordOld, user.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Mật khẩu cũ không chính xác",
        error: true,
        success: false,
      });
    }
    const isSameOld = await bcryptjs.compare(passwordNew, user.password);
    if (isSameOld) {
      return res.status(400).json({
        message: "Mật khẩu mới không được trùng mật khẩu cũ",
        error: true,
        success: false,
      });
    }
    if (passwordNew !== confirmPasswordNew) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mật khẩu không trùng khớp!",
      });
    }
    const salt = await bcryptjs.genSalt(10);
    const hashPasswordNew = await bcryptjs.hash(passwordNew, salt);
    user.password = hashPasswordNew;
    await user.save();
    return res.status(200).json({
      error: false,
      success: true,
      message: "Đổi mật khẩu thành công!",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//verify email
module.exports.verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email không chính xác!",
      });
    }
    if (user.otp_expiry > Date.now() && user.otp == otp) {
      user.verify_email = true;
      user.otp = null;
      user.otp_expiry = null;
      await user.save();
      return res.status(200).json({
        error: false,
        success: true,
        message: "Xác minh email thành công",
      });
    }
    if (user.otp !== otp) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP không chính xác",
      });
    } else {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP đã hết hạn",
      });
    }
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//login
module.exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Tài khoản không tồn tại!",
      });
    }
    if (user.verify_email == false) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Email chưa được xác minh!",
      });
    }
    const checkedPassword = await bcryptjs.compare(password, user.password);
    if (!checkedPassword) {
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mật khẩu không chính xác!",
      });
    }
    const accessToken = await generateAccessToken(user._id);
    const refreshToken = await generateRefreshToken(user._id);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());
    //tạo my document nếu chưa có

    const document = await myDocument(user._id);

    return res.status(200).json({
      error: false,
      success: true,
      message: "Đăng nhập thành công",
      data: {
        accessToken,

        documentId: document._id,
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//logout
module.exports.logout = async (req, res) => {
  try {
    const userId = res.locals.userId;
    res.clearCookie("refreshToken", clearRefreshCookieOptions());
    await User.findOneAndUpdate(
      { _id: userId },
      {
        refresh_token: "",
      },
    );
    return res.status(200).json({
      success: true,
      error: false,
      message: "Đăng xuất thành công!",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};
//forgot-password
module.exports.forgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const emailFingerprint = getEmailFingerprint(email);
    const genericResponse = {
      message:
        "Nếu tài khoản tồn tại, mã xác minh đặt lại mật khẩu đã được gửi",
      error: false,
      success: true,
    };
    const user = await User.findOne({ email });

    if (!user) {
      writePasswordResetAudit(req, "otp_requested", {
        outcome: "accepted",
        emailFingerprint,
      });
      return res.status(200).json(genericResponse);
    }

    const cooldownCreated = await redis.set(getCooldownKey(email), "1", {
      EX: PASSWORD_RESET_COOLDOWN_SECONDS,
      NX: true,
    });

    if (!cooldownCreated) {
      writePasswordResetAudit(req, "otp_requested", {
        outcome: "rate_limited",
        userId: user._id.toString(),
        emailFingerprint,
      });
      return res.status(200).json(genericResponse);
    }

    const verifyCode = generateOtp();
    await redis.set(
      getOtpKey(email),
      JSON.stringify({
        otpHash: hashOtp(email, verifyCode),
        userId: user._id.toString(),
        attempts: 0,
      }),
      { EX: PASSWORD_RESET_TTL_SECONDS },
    );

    const subject = "Mã OTP xác minh";
    const html = `Mã OTP để xác quy Email của bạn là: <b style="color:green">${verifyCode}</b>. Thời hạn sử dụng là: ${Math.ceil(
      PASSWORD_RESET_TTL_SECONDS / 60,
    )} phút`;
    sendMail(email, subject, html);

    writePasswordResetAudit(req, "otp_issued", {
      outcome: "success",
      userId: user._id.toString(),
      emailFingerprint,
    });

    return res.status(200).json(genericResponse);
  } catch (error) {
    writePasswordResetAudit(req, "otp_requested", {
      outcome: "error",
    });
    return res.status(500).json({
      message: "Không thể xử lý yêu cầu đặt lại mật khẩu",
      error: true,
      success: false,
    });
  }
};
//verify forgot-password
module.exports.verifyForgotPassword = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const emailFingerprint = getEmailFingerprint(email);
    const verification = await verifyOtpChallenge(
      redis,
      email,
      hashOtp(email, req.body.otp),
    );

    if (verification.status === "missing") {
      writePasswordResetAudit(req, "otp_verified", {
        outcome: "expired_or_missing",
        emailFingerprint,
      });
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP không hợp lệ hoặc đã hết hạn",
      });
    }

    if (verification.status === "locked") {
      writePasswordResetAudit(req, "otp_verified", {
        outcome: "locked",
        emailFingerprint,
      });
      return res.status(429).json({
        error: true,
        success: false,
        message: "Đã thử sai OTP quá nhiều lần. Vui lòng yêu cầu mã mới",
      });
    }

    if (verification.status === "invalid") {
      writePasswordResetAudit(req, "otp_verified", {
        outcome: "invalid",
        emailFingerprint,
        attempts: verification.attempts,
      });
      return res.status(400).json({
        error: true,
        success: false,
        message: "Mã OTP không chính xác",
      });
    }

    const resetTicket = generateResetTicket();
    await redis.set(
      getTicketKey(resetTicket),
      JSON.stringify({ userId: verification.userId }),
      { EX: PASSWORD_RESET_TTL_SECONDS },
    );

    writePasswordResetAudit(req, "otp_verified", {
      outcome: "success",
      userId: verification.userId,
      emailFingerprint,
    });

    return res.status(200).json({
      error: false,
      success: true,
      message: "Xác minh OTP thành công",
      data: {
        resetTicket,
        expiresIn: PASSWORD_RESET_TTL_SECONDS,
      },
    });
  } catch (error) {
    writePasswordResetAudit(req, "otp_verified", {
      outcome: "error",
    });
    return res.status(500).json({
      message: "Không thể xác minh OTP",
      error: true,
      success: false,
    });
  }
};
//reset-password
module.exports.resetPassword = async (req, res) => {
  let ticketData;
  try {
    const { resetTicket, newPassword } = req.body;
    ticketData = await consumeResetTicket(redis, resetTicket);

    if (!ticketData?.userId) {
      writePasswordResetAudit(req, "password_reset", {
        outcome: "invalid_or_expired_ticket",
      });
      return res.status(400).json({
        error: true,
        success: false,
        message: "Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
      });
    }

    const user = await User.findById(ticketData.userId);
    if (!user) {
      writePasswordResetAudit(req, "password_reset", {
        outcome: "user_missing",
        userId: ticketData.userId,
      });
      return res.status(404).json({
        error: true,
        success: false,
        message: "Không thể đặt lại mật khẩu",
      });
    }

    const salt = await bcryptjs.genSalt(10);
    const hashPassword = await bcryptjs.hash(newPassword, salt);
    user.password = hashPassword;
    user.refresh_token = "";
    user.access_token = "";
    await user.save();

    res.clearCookie("refreshToken", clearRefreshCookieOptions());

    writePasswordResetAudit(req, "password_reset", {
      outcome: "success",
      userId: user._id.toString(),
      sessionsRevoked: true,
    });

    return res.status(200).json({
      error: false,
      success: true,
      message: "Đổi mật khẩu thành công!",
    });
  } catch (error) {
    writePasswordResetAudit(req, "password_reset", {
      outcome: "error",
      userId: ticketData?.userId,
    });
    return res.status(500).json({
      message: "Không thể đặt lại mật khẩu",
      error: true,
      success: false,
    });
  }
};
//refreshToken
module.exports.refreshToken = async (req, res) => {
  try {
    const { userId, refreshToken } = await rotateRefreshToken(
      req.cookies?.refreshToken,
    );
    const newAccessToken = await generateAccessToken(userId);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());
    return res.status(200).json({
      error: false,
      success: true,
      message: "Token mới đã được tạo!",
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    if (error instanceof RefreshTokenError) {
      res.clearCookie("refreshToken", clearRefreshCookieOptions());
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
        error: true,
        success: false,
      });
    }
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

//passkey register options
module.exports.passkeyRegisterOptions = async (req, res) => {
  try {
    const user = await User.findById(res.locals.userId);

    if (!user)
      return res
        .status(400)
        .json({ error: true, message: "Không tìm thấy người dùng" });
    const passkeys = await Passkey.find({ user: user._id });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: passkeys?.map((passkey) => ({
        id: passkey.credentialID,
        transports: passkey.transports,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
        authenticatorAttachment: "platform",
      },
    });

    const challengeId = randomUUID();

    await redis.set(
      `passkey-register:${challengeId}`,
      JSON.stringify({
        challenge: options.challenge,
        webauthnUserID: options.user.id,
        userId: user._id,
      }),
      {
        EX: 300,
      },
    );

    return res.status(200).json({
      ...options,
      challengeId,
      success: true,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Lỗi server", error: true, success: false });
  }
};
//passkey register verify
module.exports.passkeyRegisterVerify = async (req, res) => {
  const { challengeId, credential: registrationResponse } = req.body;

  const pending = await redis.get(`passkey-register:${challengeId}`);
  if (!pending) {
    return res.status(400).json({
      message: "Phiên đăng ký Passkey đã hết hạn",
    });
  }
  const challengeData = JSON.parse(pending);
  try {
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: challengeData.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ message: "Không thể xác minh Passkey" });
    }

    const user = await User.findById(challengeData.userId);
    if (!user) {
      return res.status(404).json({
        message: "Tài khoản không tồn tại!",
        error: true,
      });
    }
    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    const credentialID = credential.id;

    const exists = await Passkey.findOne({
      credentialID,
    });

    if (!exists) {
      await Passkey.create({
        credentialID,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: registrationResponse.response.transports || [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        user: user._id,
      });
    }

    await redis.del(`passkey-register:${challengeId}`);
    return res
      .status(200)
      .json({ success: true, message: "Đăng ký Passkey thành công" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Đăng ký Passkey thất bại" });
  } finally {
    await redis.del(`passkey-register:${challengeId}`);
  }
};

//passkey login options
module.exports.passkeyLoginOptions = async (req, res) => {
  try {
    const challengeId = randomUUID();

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });

    await redis.set(`passkey:${challengeId}`, options.challenge, {
      EX: 300, // 5 phút
    });
    res.status(200).json({
      success: true,
      ...options,
      challengeId,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || "Lỗi server",
      error: true,
      success: false,
    });
  }
};

//passkey login verify
module.exports.passkeyLoginVerify = async (req, res) => {
  const { challengeId, credential } = req.body;

  const expectedChallenge = await redis.get(`passkey:${challengeId}`);
  if (!expectedChallenge) {
    return res.status(400).json({
      error: true,
      message: "Challenge đã hết hạn",
    });
  }
  const credentialResponse = credential;
  const credentialID = credentialResponse.id;

  const passkey = await Passkey.findOne({
    credentialID,
  });

  if (!passkey) {
    return res.status(404).json({
      error: true,
      success: false,
      message: "Tài khoản chưa đăng kí xác thực!",
    });
  }

  const user = await User.findById(passkey.user);

  if (!user) {
    return res.status(404).json({
      success: false,
      error: true,
      message: "Không tìm thấy người dùng",
    });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: credentialResponse,
      expectedChallenge: expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialID,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });

    if (!verification.verified) {
      return res
        .status(401)
        .json({ error: true, message: "Xác minh Passkey thất bại" });
    }

    passkey.counter = verification.authenticationInfo.newCounter;
    await passkey.save();
    await redis.del(`passkey:${challengeId}`);

    const accessToken = await generateAccessToken(user._id);
    const refreshToken = await generateRefreshToken(user._id);
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());
    //tạo my document nếu chưa có

    const document = await myDocument(user._id);

    return res.status(200).json({
      error: false,
      success: true,
      message: "Đăng nhập thành công",
      data: {
        accessToken,

        documentId: document._id,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: error.message || "Đăng nhập Passkey thất bại" });
  } finally {
    await redis.del(`passkey:${challengeId}`);
  }
};

//delete passkey
module.exports.deletePasskey = async (req, res) => {
  try {
    await Passkey.deleteMany({
      user: res.locals.userId,
    });
    return res.status(200).json({
      success: true,
      error: false,
      message: "Đã tắt Passkey thành công.",
    });
  } catch (error) {
    return res.status(500).json({
      error: true,
      success: false,
      message: error.message || "Lỗi server",
    });
  }
};
//user Detail
module.exports.userDetail = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const user = await User.findById(userId)
      .select("-password -refreshToken")
      .lean();
    const hasPasskey = await Passkey.exists({
      user: userId,
    });
    return res.status(200).json({
      message: "Chi tiết người dùng",
      error: false,
      data: { ...user, hasPasskey: !!hasPasskey },
      success: true,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Get user detail failed");
  }
};
//avatar user
module.exports.userImage = async (req, res) => {
  let imageCommitted = false;
  try {
    const userId = res.locals.userId;
    const type = req.body.type;
    if (!["avatar", "background"].includes(type)) {
      await cleanupAssets(req.uploadedCloudinaryAssets).catch(() => {});
      return res.status(400).json({
        error: true,
        success: false,
        message: "Loại ảnh không hợp lệ",
      });
    }
    const user = await User.findById(userId);
    if (!user) {
      await cleanupAssets(req.uploadedCloudinaryAssets).catch(() => {});
      return res.status(400).json({
        error: true,
        success: false,
      });
    }
    let previousPublicId;
    if (type == "avatar") {
      previousPublicId = user.avatar_public_id;
      user.avatar = req.body.image || user.avatar;
      user.avatar_public_id = req.body.image_id || user.avatar_public_id;
    }
    if (type == "background") {
      previousPublicId = user.background_public_id;
      user.background = req.body.image || user.background;
      user.background_public_id =
        req.body.image_id || user.background_public_id;
    }
    await user.save();
    imageCommitted = Boolean(req.body.image);
    if (req.body.image && previousPublicId) {
      enqueueMediaCleanup([
        { public_id: previousPublicId, resource_type: "image" },
      ]).catch((cleanupError) => {
        console.error("Previous profile image cleanup enqueue failed", cleanupError);
      });
    }
    return res.status(200).json({
      message: "Cập nhật thành công",
      error: false,
      success: true,
      data: user,
    });
  } catch (error) {
    if (!imageCommitted) {
      await cleanupAssets(req.uploadedCloudinaryAssets).catch(
        (cleanupError) => {
          console.error("Profile image compensation failed", cleanupError);
        },
      );
    }
    return sendInternalServerError(res, error, "Update user image failed");
  }
};
//update user
module.exports.updateUser = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const { set, unset } = validateProfileUpdate(req.body);
    const update = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const updatedUser = await User.findByIdAndUpdate(userId, update, {
      new: true,
      runValidators: true,
    });
    if (!updatedUser) {
      return res.status(404).json({
        message: "Tài khoản không tồn tại",
        error: true,
        success: false,
      });
    }
    return res.status(200).json({
      message: "Chỉnh sửa tài khoản thành công",
      error: false,
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    if (error instanceof ProfileUpdateValidationError) {
      return res.status(error.status).json({
        message: error.message,
        error: true,
        success: false,
        code: error.code,
      });
    }
    if (error?.code === 11000 && error?.keyPattern?.mobile) {
      return res.status(409).json({
        message: "Số điện thoại đã được sử dụng",
        error: true,
        success: false,
        code: "MOBILE_ALREADY_EXISTS",
      });
    }
    return sendInternalServerError(res, error, "Update user profile failed");
  }
};
//get user
module.exports.getUser = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const myUser = await User.findById(userId);

    let find = { _id: { $ne: userId } };

    // Search
    const objectSearch = searchHelper(req.query);
    if (objectSearch.mobile) find.mobile = objectSearch.mobile;

    const users = await User.find(find).select(
      "-password -refresh_token -googleId",
    );

    // Gắn trạng thái pending nếu user có trong requestFriends
    const dataWithStatus = users.map((u) => {
      const isPending = myUser.requestFriends.some(
        (rf) => rf.id.toString() === u._id.toString(),
      );
      return { ...u.toObject(), friendStatus: isPending ? "pending" : "none" };
    });

    return res.status(200).json({
      error: false,
      success: true,
      data: dataWithStatus,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Search users failed");
  }
};
//get all users
module.exports.getAllStranger = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const myUser = await User.findById(userId);
    const friendIds = myUser.FriendList.map((item) => item.user_id);
    const requestFriends = myUser.requestFriends.map((item) => item.id);
    const acceptFriends = myUser.acceptFriends.map((item) => item.id);

    const users = await User.find({
      _id: {
        $ne: userId,
        $nin: [...friendIds, ...requestFriends, ...acceptFriends],
      },
    })
      .limit(6)
      .select("name email avatar background date_of_birth gender");
    return res.status(200).json({
      error: false,
      success: true,
      data: users,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Get strangers failed");
  }
};
//friend invite list
module.exports.friendInvite = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const user = await User.findOne({ _id: userId });
    const acceptFriendIds = user.acceptFriends.map((item) => item.id);
    const users = await User.find({
      _id: { $in: acceptFriendIds },
    }).select(
      "name email avatar background date_of_birth mobile gender requestFriends",
    );

    return res.status(200).json({
      success: true,
      error: false,
      data: users,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Get friend invites failed");
  }
};
//list friend
module.exports.friendList = async (req, res) => {
  try {
    const userId = res.locals.userId;
    const myUser = await User.findOne({ _id: userId });
    const friendList = myUser.FriendList;
    const friendListId = friendList.map((item) => item.user_id);
    const users = await User.find({
      _id: { $in: friendListId },
    }).select("name email avatar background date_of_birth mobile gender");
    const usersWithInfo = users.map((user) => {
      const infoFriend = friendList.find(
        (f) => f.user_id.toString() === user._id.toString(),
      );
      return {
        ...user.toObject(),
        infoFriend,
      };
    });

    const countFriend = users.length;
    return res.status(200).json({
      success: true,
      error: false,
      data: usersWithInfo,
      count: countFriend,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Get friend list failed");
  }
};

//search user
module.exports.searchUser = async (req, res) => {
  try {
    const keyword = req.query.keyword; // email hoặc mobile
    const userId = res.locals.userId;

    // Tìm user khác userId và email OR mobile khớp
    const user = await User.findOne({
      _id: { $ne: userId },
      $or: [{ email: keyword }, { mobile: keyword }],
    }).select(
      "-password -refresh_token -googleId -requestFriends -acceptFriends -FriendList",
    );

    if (!user) {
      return res.status(404).json({
        error: true,
        success: false,
        message: "Không tìm thấy người dùng",
        data: [],
      });
    }

    return res.status(200).json({
      error: false,
      success: true,
      data: user,
    });
  } catch (error) {
    return sendInternalServerError(res, error, "Find user failed");
  }
};
