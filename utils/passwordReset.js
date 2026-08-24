const crypto = require("crypto");

const PASSWORD_RESET_TTL_SECONDS = 10 * 60;
const PASSWORD_RESET_COOLDOWN_SECONDS = 60;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

const normalizeEmail = (email) => email.trim().toLowerCase();

const emailKey = (email) =>
  crypto.createHash("sha256").update(normalizeEmail(email)).digest("hex");

const getOtpKey = (email) => `password-reset:otp:${emailKey(email)}`;
const getCooldownKey = (email) =>
  `password-reset:cooldown:${emailKey(email)}`;

const getTicketKey = (ticket) =>
  `password-reset:ticket:${hashResetTicket(ticket)}`;

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const hashOtp = (email, otp) => {
  const secret = process.env.JWT_SECRET_KEY;

  if (!secret) {
    throw new Error("JWT_SECRET_KEY is required to hash password reset OTPs");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`${normalizeEmail(email)}:${otp}`)
    .digest("hex");
};

const generateResetTicket = () => crypto.randomBytes(32).toString("base64url");

const hashResetTicket = (ticket) =>
  crypto.createHash("sha256").update(ticket).digest("hex");

module.exports = {
  PASSWORD_RESET_TTL_SECONDS,
  PASSWORD_RESET_COOLDOWN_SECONDS,
  PASSWORD_RESET_MAX_ATTEMPTS,
  normalizeEmail,
  getOtpKey,
  getCooldownKey,
  getTicketKey,
  generateOtp,
  hashOtp,
  generateResetTicket,
  hashResetTicket,
};
