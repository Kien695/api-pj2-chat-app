const crypto = require("crypto");
const redis = require("../config/redis");

const OAUTH_TICKET_TTL_SECONDS = 60;
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class OAuthLoginTicketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OAuthLoginTicketError";
    this.status = 400;
    this.code = code;
  }
}

const ticketKey = (code) =>
  `oauth-login:${crypto.createHash("sha256").update(code).digest("hex")}`;

const createOAuthLoginTicket = async (
  userId,
  documentId,
  redisClient = redis,
) => {
  const code = crypto.randomBytes(32).toString("base64url");
  await redisClient.set(
    ticketKey(code),
    JSON.stringify({ userId: userId.toString(), documentId: documentId.toString() }),
    { EX: OAUTH_TICKET_TTL_SECONDS },
  );
  return code;
};

const consumeOAuthLoginTicket = async (code, redisClient = redis) => {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
    throw new OAuthLoginTicketError("INVALID_OAUTH_LOGIN_CODE", "Mã đăng nhập OAuth không hợp lệ");
  }
  const rawTicket = await redisClient.getDel(ticketKey(code));
  if (!rawTicket) {
    throw new OAuthLoginTicketError("OAUTH_LOGIN_CODE_EXPIRED", "Mã đăng nhập OAuth đã hết hạn hoặc đã được sử dụng");
  }
  try {
    const ticket = JSON.parse(rawTicket);
    if (!ticket.userId || !ticket.documentId) throw new Error("Malformed ticket");
    return ticket;
  } catch {
    throw new OAuthLoginTicketError("INVALID_OAUTH_LOGIN_CODE", "Mã đăng nhập OAuth không hợp lệ");
  }
};

module.exports = {
  OAuthLoginTicketError,
  consumeOAuthLoginTicket,
  createOAuthLoginTicket,
  ticketKey,
};
