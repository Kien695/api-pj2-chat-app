const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();
const cookieParser = require("cookie-parser");
const jsonWebToken = require("jsonwebtoken");
const helmet = require("helmet");
const database = require("./config/database");
const { app, server } = require("./socket/index");
database.connect();
const port = process.env.PORT;
app.set("trust proxy", 1);
// const app = express();
app.use(
  cors({
    origin: process.env.FE_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(helmet());
const router = require("./router/index.router");
router(app);
server.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
