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

const verifyOtpChallenge = async (redis, email, submittedOtpHash) => {
  const result = await redis.eval(
    `
      local value = redis.call('GET', KEYS[1])
      if not value then
        return { 'missing' }
      end

      local challenge = cjson.decode(value)
      if challenge.otpHash ~= ARGV[1] then
        challenge.attempts = (challenge.attempts or 0) + 1
        if challenge.attempts >= tonumber(ARGV[2]) then
          redis.call('DEL', KEYS[1])
          return { 'locked' }
        end

        local ttl = redis.call('TTL', KEYS[1])
        redis.call('SET', KEYS[1], cjson.encode(challenge), 'EX', ttl)
        return { 'invalid', tostring(challenge.attempts) }
      end

      redis.call('DEL', KEYS[1])
      return { 'verified', challenge.userId }
    `,
    {
      keys: [getOtpKey(email)],
      arguments: [submittedOtpHash, String(PASSWORD_RESET_MAX_ATTEMPTS)],
    },
  );

  return {
    status: result[0],
    attempts:
      result[0] === "invalid" && result[1] ? Number(result[1]) : undefined,
    userId: result[0] === "verified" ? result[1] : undefined,
  };
};

const consumeResetTicket = async (redis, ticket) => {
  const value = await redis.getDel(getTicketKey(ticket));
  return value ? JSON.parse(value) : null;
};

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
  verifyOtpChallenge,
  consumeResetTicket,
};
