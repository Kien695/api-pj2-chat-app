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

    await redis.set(
      "qr:" + sessionId,
      JSON.stringify({
        status: "waiting",

        userId: null,
      }),
      {
        EX: process.env.QR_EXPIRE_TIME,
      },
    );

    res.json({
      success: true,
      error: false,
      data: { sessionId, expiresIn: process.env.QR_EXPIRE_TIME },
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
    console.log(sessionId);
    const data = await redis.get("qr:" + sessionId);

    if (!data) {
      return res.status(404).json({
        message: "QR hết hạn",
      });
    }

    const qr = JSON.parse(data);

    qr.status = "approved";

    qr.userId = res.locals.userId;
    console.log(res.locals.userId);
    await redis.set("qr:" + sessionId, JSON.stringify(qr), {
      EX: 15,
    });
    const io = getIO();
    io.to(sessionId).emit("QR_APPROVED");

    res.status(200).json({
      message: "Quét thành công!",
      error: false,
      success: true,
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
      return res.status(404).json();
    }

    const qr = JSON.parse(data);

    if (qr.status != "approved") {
      return res.status(400).json({
        message: "Chưa quét",
      });
    }

    const accessToken = await generateAccessToken(qr.userId);
    const refreshToken = await generateRefreshToken(qr.userId);
    const cookiesOption = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    };

    res.cookie("refreshToken", refreshToken, cookiesOption);
    //tạo my document nếu chưa có

    const document = await myDocument(qr.userId);
    await redis.del("qr:" + sessionId);

    res.status(200).json({
      success: true,
      message: "Login Success",
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
