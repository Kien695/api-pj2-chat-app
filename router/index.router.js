const useRouter = require("./user.router");
const authRouter = require("./auth.router");
module.exports = (app) => {
  app.use("/auth", useRouter);
  app.use("/auth", authRouter);
};
