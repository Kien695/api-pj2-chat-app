const useRouter = require("./user.router");
module.exports = (app) => {
  app.use("/auth", useRouter);
};
