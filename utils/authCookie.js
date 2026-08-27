const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: REFRESH_COOKIE_MAX_AGE_MS,
});

const clearRefreshCookieOptions = () => {
  const { maxAge, ...options } = refreshCookieOptions();
  return options;
};

module.exports = { clearRefreshCookieOptions, refreshCookieOptions };
