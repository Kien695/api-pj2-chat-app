const crypto = require("crypto");
const {
  issueAuthenticationSession,
  sessionMetadataFromRequest,
} = require("../service/authenticationSessionIssuance.service");
const redis = require("../config/redis");
const { getIO } = require("../socket");
const { myDocument } = require("../helper/createMyDocument");
const { refreshCookieOptions } = require("../utils/authCookie");
const {
  OAuthLoginTicketError,
  consumeOAuthLoginTicket,
  createOAuthLoginTicket,
} = require("../service/oauthLoginTicket.service");
const {
  QrSessionSecurityError,
  createSubscriberCredential,
  qrKey,
  qrRoomName,
  requireQrActor,
  validateQrSessionId,
} = require("../service/qrSessionSecurity.service");
const { writeLog } = require("../utils/structuredLogger");
const sendQrSecurityError = (res, error) => {
  if (!(error instanceof QrSessionSecurityError)) return false;
  res.status(error.status).json({
    message: error.message,
    code: error.code,
    error: true,
    success: false,
  });
  return true;
};
//login oauth20
module.exports.login = async (req, res) => {
  try {
    const loginCode = await createOAuthLoginTicket(
      req.user.user._id,
      req.user.documentId,
    );
    res.redirect(
      `${process.env.CLIENT_URL}/auth-success?code=${encodeURIComponent(loginCode)}`,
    );
  } catch (error) {
    writeLog("error", "oauth_login_failed", { error });
    res.redirect(`${process.env.CLIENT_URL}/login?error=oauth_failed`);
  }
};
//login qr
module.exports.createQr = async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const { subscriberToken, subscriberTokenHash } =
      createSubscriberCredential();
    const deviceInfo = req.body.deviceInfo || req.headers["user-agent"] || "Máy tính (Web)";

    await redis.set(
      qrKey(sessionId),
      JSON.stringify({
        status: "waiting",
        deviceInfo: deviceInfo,
        userId: null,
        subscriberTokenHash,
      }),
      {
        EX: Number(process.env.QR_EXPIRE_TIME) || 60,
      },
    );

    res.json({
      success: true,
      error: false,
      data: {
        sessionId,
        subscriberToken,
        expiresIn: Number(process.env.QR_EXPIRE_TIME) || 60,
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

module.exports.scanQR = async (req, res) => {
  try {
    const sessionId = validateQrSessionId(req.body.sessionId);
    const data = await redis.get(qrKey(sessionId));

    if (!data) {
      return res.status(404).json({
        message: "Mã QR đã hết hạn hoặc không tồn tại",
        success: false,
        error: true,
      });
    }

    const qr = JSON.parse(data);

    if (qr.status !== "waiting") {
      return res.status(409).json({
        message: "Mã QR đã được sử dụng",
        success: false,
        error: true,
      });
    }

    qr.status = "scanned";
    qr.userId = res.locals.userId;
    writeLog("info", "qr_login_scanned", {
      requestId: res.locals.requestId,
      outcome: "success",
    });

    await redis.set(qrKey(sessionId), JSON.stringify(qr), {
      EX: 60,
    });

    const io = getIO();
    io.to(qrRoomName(sessionId)).emit("QR_SCANNED", {
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
    if (sendQrSecurityError(res, error)) return;
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

module.exports.exchangeOAuthCode = async (req, res) => {
  try {
    const ticket = await consumeOAuthLoginTicket(req.body?.code);
    const { accessToken, refreshToken } = await issueAuthenticationSession({
      userId: ticket.userId,
      metadata: sessionMetadataFromRequest(req, "google"),
    });
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());
    return res.status(200).json({
      success: true,
      error: false,
      data: { accessToken, documentId: ticket.documentId },
    });
  } catch (error) {
    if (error instanceof OAuthLoginTicketError) {
      return res.status(error.status).json({
        success: false,
        error: true,
        code: error.code,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: true,
      message: "Không thể hoàn tất đăng nhập OAuth",
    });
  }
};

module.exports.confirm = async (req, res) => {
  try {
    const sessionId = validateQrSessionId(req.body.sessionId);

    const data = await redis.get(qrKey(sessionId));

    if (!data) {
      return res.status(404).json({
        message: "Phiên đăng nhập QR đã hết hạn",
        success: false,
        error: true,
      });
    }

    const qr = JSON.parse(data);
    requireQrActor(qr, res.locals.userId);

    if (qr.status !== "scanned") {
      return res.status(400).json({
        message: "Mã QR chưa được quét",
        success: false,
        error: true,
      });
    }

    qr.status = "approved";

    const { accessToken, refreshToken } = await issueAuthenticationSession({
      userId: qr.userId,
      metadata: sessionMetadataFromRequest(req, "qr", {
        deviceInfo: qr.deviceInfo,
      }),
    });
    res.cookie("refreshToken", refreshToken, refreshCookieOptions());

    const document = await myDocument(qr.userId);
    await redis.del(qrKey(sessionId));

    const io = getIO();
    io.to(qrRoomName(sessionId)).emit("QR_APPROVED", {
      accessToken,
      documentId: document._id,
    });

    res.status(200).json({
      success: true,
      message: "Đăng nhập thành công trên máy tính!",
      data: { accessToken, documentId: document._id },
    });
  } catch (error) {
    if (sendQrSecurityError(res, error)) return;
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

module.exports.cancelQR = async (req, res) => {
  try {
    const sessionId = validateQrSessionId(req.body.sessionId);
    if (sessionId) {
      const data = await redis.get(qrKey(sessionId));
      if (!data) {
        return res.status(404).json({
          message: "Phiên đăng nhập QR đã hết hạn",
          success: false,
          error: true,
        });
      }
      const qr = JSON.parse(data);
      requireQrActor(qr, res.locals.userId);
      await redis.del(qrKey(sessionId));
      const io = getIO();
      io.to(qrRoomName(sessionId)).emit("QR_REJECTED");
    }
    return res.status(200).json({
      success: true,
      message: "Đã hủy thao tác đăng nhập",
    });
  } catch (error) {
    if (sendQrSecurityError(res, error)) return;
    return res.status(500).json({
      message: error.message || error,
      error: true,
      success: false,
    });
  }
};

