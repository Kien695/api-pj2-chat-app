const {
  AccessTokenAuthenticationError,
  extractBearerToken,
  verifyAccessToken,
} = require("../service/accessTokenAuthentication.service");

module.exports.auth = (req, res, next) => {
  try {
    const token = extractBearerToken(req.headers?.authorization);
    const decoded = verifyAccessToken(token);

    res.locals.userId = decoded.id;
    next();
  } catch (error) {
    const authenticationError =
      error instanceof AccessTokenAuthenticationError
        ? error
        : new AccessTokenAuthenticationError(
            "INVALID_ACCESS_TOKEN",
            "Token không hợp lệ",
          );
    return res.status(401).json({
      error: true,
      success: false,
      message: authenticationError.message,
      code: authenticationError.code,
      ...(authenticationError.expired ? { expired: true } : {}),
    });
  }
};
