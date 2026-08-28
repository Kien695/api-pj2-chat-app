const sendInternalServerError = (res, error, context) => {
  console.error(context, {
    name: error?.name,
    code: error?.code,
  });

  return res.status(500).json({
    message: "Lỗi server",
    error: true,
    success: false,
  });
};

module.exports = { sendInternalServerError };
