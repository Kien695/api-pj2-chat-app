const useRouter = require("./user.router");
const authRouter = require("./auth.router");
const chatRouter = require("./chat.router");
const healthRouter = require("./health.router");
const metricsRouter = require("./metrics.router");
const middleware = require("../middleware/auth.middleware");
const { handleHttpError } = require("../middleware/error.middleware");
module.exports = (app) => {
  app.use("/health", healthRouter);
  app.use("/metrics", metricsRouter);
  app.use("/auth", useRouter);
  app.use("/auth", authRouter);
  app.use("/chat", middleware.auth, chatRouter);
  app.use(handleHttpError);
};
