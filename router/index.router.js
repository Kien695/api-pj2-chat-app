const useRouter = require("./user.router");
const authRouter = require("./auth.router");
const chatRouter = require("./chat.router");
module.exports = (app) => {
  app.use("/auth", useRouter);
  app.use("/auth", authRouter);
  app.use("/chat", chatRouter);
};
