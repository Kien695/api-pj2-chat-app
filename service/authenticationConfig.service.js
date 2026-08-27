const MINIMUM_JWT_SECRET_LENGTH = 24;

const validateAuthenticationConfig = (environment = process.env) => {
  const accessSecret = environment.JWT_ACCESS_TOKEN;
  const refreshSecret = environment.JWT_REFRESH_TOKEN;
  for (const [name, value] of [
    ["JWT_ACCESS_TOKEN", accessSecret],
    ["JWT_REFRESH_TOKEN", refreshSecret],
  ]) {
    if (typeof value !== "string" || value.length < MINIMUM_JWT_SECRET_LENGTH) {
      throw new Error(`${name} must contain at least ${MINIMUM_JWT_SECRET_LENGTH} characters`);
    }
  }
  if (accessSecret === refreshSecret) {
    throw new Error("JWT access and refresh secrets must be different");
  }
};

module.exports = { validateAuthenticationConfig };
