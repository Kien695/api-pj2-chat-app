const { sendInternalServerError } = require("../utils/httpErrorResponse");

const handleHttpError = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  return sendInternalServerError(res, error, "Unhandled HTTP request error");
};

module.exports = { handleHttpError };
