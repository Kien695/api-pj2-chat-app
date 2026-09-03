const { writeLog } = require("./structuredLogger");

const sendInternalServerError = (res, error, context) => {
  writeLog("error", "internal_server_error", {
    requestId: res.locals?.requestId,
    context,
    error,
  });

  return res.status(500).json({
    message: "Lỗi server",
    error: true,
    success: false,
  });
};

module.exports = { sendInternalServerError };
