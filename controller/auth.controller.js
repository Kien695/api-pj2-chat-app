const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { generateRefreshToken } = require("../utils/generateRefreshToken");
const { generateAccessToken } = require("../utils/generateAccessToken");
const redis = require("../config/redis");
const { getIO } = require("../socket");
const { myDocument } = require("../helper/createMyDocument");
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
//login qr
module.exports.createQr = async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const deviceInfo = req.body.deviceInfo || req.headers["user-agent"] || "Máy tính (Web)";

    await redis.set(
      "qr:" + sessionId,
      JSON.stringify({
        status: "waiting",
        deviceInfo: deviceInfo,
        userId: null,
      }),
      {
        EX: Number(process.env.QR_EXPIRE_TIME) || 60,
      },
    );

    res.json({
      success: true,
      error: false,
      data: { sessionId, expiresIn: Number(process.env.QR_EXPIRE_TIME) || 60 },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

module.exports.scanQR = async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    console.log("Scanned QR SessionId:", sessionId);
    const data = await redis.get("qr:" + sessionId);

    if (!data) {
      return res.status(404).json({
        message: "Mã QR đã hết hạn hoặc không tồn tại",
        success: false,
        error: true,
      });
    }

    const qr = JSON.parse(data);

    qr.status = "scanned";
    qr.userId = res.locals.userId;
    console.log("Scanned by User:", res.locals.userId);

    await redis.set("qr:" + sessionId, JSON.stringify(qr), {
      EX: 60,
    });

    const io = getIO();
    io.to(sessionId).emit("QR_SCANNED", {
      userId: res.locals.userId,
      deviceInfo: qr.deviceInfo,
    });

    res.status(200).json({
      message: "Quét thành công! Vui lòng xác nhận trên điện thoại.",
      error: false,
      success: true,
      data: {
        sessionId,
        deviceInfo: qr.deviceInfo || "Máy tính (Web)",
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

module.exports.confirm = async (req, res) => {
  try {
    const sessionId = req.body.sessionId;

    const data = await redis.get("qr:" + sessionId);

    if (!data) {
      return res.status(404).json({
        message: "Phiên đăng nhập QR đã hết hạn",
        success: false,
        error: true,
      });
    }

    const qr = JSON.parse(data);

    if (qr.status !== "scanned" && qr.status !== "approved") {
      return res.status(400).json({
        message: "Mã QR chưa được quét",
        success: false,
        error: true,
      });
    }

    qr.status = "approved";

    const accessToken = await generateAccessToken(qr.userId);
    const refreshToken = await generateRefreshToken(qr.userId);
    const cookiesOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    };

    res.cookie("refreshToken", refreshToken, cookiesOption);

    const document = await myDocument(qr.userId);
    await redis.del("qr:" + sessionId);

    const io = getIO();
    io.to(sessionId).emit("QR_APPROVED", {
      accessToken,
      documentId: document._id,
    });

    res.status(200).json({
      success: true,
      message: "Đăng nhập thành công trên máy tính!",
      data: { accessToken, documentId: document._id },
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

module.exports.cancelQR = async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    if (sessionId) {
      await redis.del("qr:" + sessionId);
      const io = getIO();
      io.to(sessionId).emit("QR_REJECTED");
    }
    return res.status(200).json({
      success: true,
      message: "Đã hủy thao tác đăng nhập",
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

