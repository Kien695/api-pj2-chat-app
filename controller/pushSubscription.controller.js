const {
  PushSubscriptionError,
  registerPushSubscription,
  removePushSubscription,
} = require("../service/pushSubscription.service");
const { sendInternalServerError } = require("../utils/httpErrorResponse");

const sendPushSubscriptionError = (res, error) => {
  if (!(error instanceof PushSubscriptionError)) return false;
  res.status(error.status).json({
    success: false,
    error: true,
    code: error.code,
    message: error.message,
  });
  return true;
};

module.exports.register = async (req, res) => {
  try {
    const subscription = await registerPushSubscription({
      userId: res.locals.userId,
      body: req.body,
      deviceInfo: req.headers["user-agent"],
      sessionId: res.locals.sessionId,
    });
    return res.status(200).json({
      success: true,
      error: false,
      data: { subscriptionId: subscription._id },
    });
  } catch (error) {
    if (sendPushSubscriptionError(res, error)) return;
    return sendInternalServerError(res, error, "Push subscription registration failed");
  }
};

module.exports.remove = async (req, res) => {
  try {
    await removePushSubscription({
      userId: res.locals.userId,
      subscriptionId: req.params.subscriptionId,
    });
    return res.status(200).json({ success: true, error: false });
  } catch (error) {
    if (sendPushSubscriptionError(res, error)) return;
    return sendInternalServerError(res, error, "Push subscription removal failed");
  }
};
