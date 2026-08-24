const assert = require("node:assert/strict");
const { after, before, describe, test } = require("node:test");

const passwordReset = require("../utils/passwordReset");
const validators = require("../validate/auth.validate");
const {
  getEmailFingerprint,
  writePasswordResetAudit,
} = require("../utils/passwordResetAudit");

const originalOtpSecret = process.env.JWT_SECRET_KEY;

before(() => {
  process.env.JWT_SECRET_KEY = "password-reset-test-secret";
});

after(() => {
  if (originalOtpSecret === undefined) {
    delete process.env.JWT_SECRET_KEY;
  } else {
    process.env.JWT_SECRET_KEY = originalOtpSecret;
  }
});

const runValidator = (validator, body) => {
  let statusCode;
  let responseBody;
  let nextCalled = false;
  const req = { body };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      responseBody = payload;
      return this;
    },
  };

  validator(req, res, () => {
    nextCalled = true;
  });

  return { body: req.body, nextCalled, responseBody, statusCode };
};

describe("password reset primitives", () => {
  test("generates a six-digit OTP and a 256-bit reset ticket", () => {
    assert.match(passwordReset.generateOtp(), /^\d{6}$/);
    assert.match(passwordReset.generateResetTicket(), /^[A-Za-z0-9_-]{43}$/);
  });

  test("does not expose plaintext email or ticket in Redis keys", () => {
    const email = "User@Example.com";
    const ticket = passwordReset.generateResetTicket();

    assert.equal(passwordReset.getOtpKey(email).includes(email), false);
    assert.equal(passwordReset.getTicketKey(ticket).includes(ticket), false);
  });

  test("normalizes email before hashing an OTP", () => {
    const otp = "123456";
    assert.equal(
      passwordReset.hashOtp(" User@Example.com ", otp),
      passwordReset.hashOtp("user@example.com", otp),
    );
  });

  test("consumes a reset ticket only once and rejects replay", async () => {
    const ticket = passwordReset.generateResetTicket();
    const values = new Map([
      [passwordReset.getTicketKey(ticket), JSON.stringify({ userId: "u1" })],
    ]);
    const redis = {
      async getDel(key) {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      },
    };

    assert.deepEqual(await passwordReset.consumeResetTicket(redis, ticket), {
      userId: "u1",
    });
    assert.equal(await passwordReset.consumeResetTicket(redis, ticket), null);
  });

  test("rejects a missing or expired reset ticket", async () => {
    const redis = { getDel: async () => null };
    assert.equal(
      await passwordReset.consumeResetTicket(
        redis,
        passwordReset.generateResetTicket(),
      ),
      null,
    );
  });

  test("maps atomic OTP verification outcomes", async () => {
    const cases = [
      { redisResult: ["missing"], expected: { status: "missing" } },
      {
        redisResult: ["invalid", "2"],
        expected: { status: "invalid", attempts: 2 },
      },
      { redisResult: ["locked"], expected: { status: "locked" } },
      {
        redisResult: ["verified", "u1"],
        expected: { status: "verified", userId: "u1" },
      },
    ];

    for (const { redisResult, expected } of cases) {
      const redis = { eval: async () => redisResult };
      const result = await passwordReset.verifyOtpChallenge(
        redis,
        "user@example.com",
        passwordReset.hashOtp("user@example.com", "123456"),
      );
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(result).filter(([, value]) => value !== undefined),
        ),
        expected,
      );
    }
  });
});

describe("password reset validators", () => {
  test("normalizes a valid forgot-password email", () => {
    const result = runValidator(validators.authForgotPassword, {
      email: " User@Example.COM ",
    });

    assert.equal(result.nextCalled, true);
    assert.equal(result.body.email, "user@example.com");
  });

  test("requires an exact six-digit OTP", () => {
    const valid = runValidator(validators.verifyForgotPassword, {
      email: "user@example.com",
      otp: "123456",
    });
    const invalid = runValidator(validators.verifyForgotPassword, {
      email: "user@example.com",
      otp: "12345",
    });

    assert.equal(valid.nextCalled, true);
    assert.equal(invalid.statusCode, 400);
  });

  test("blocks the old email-only password reset bypass", () => {
    const result = runValidator(validators.authResetPassword, {
      email: "victim@example.com",
      newPassword: "Password@1",
      confirmPassword: "Password@1",
    });

    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 400);
  });

  test("accepts a valid ticket and rejects weak or mismatched passwords", () => {
    const resetTicket = passwordReset.generateResetTicket();
    const valid = runValidator(validators.authResetPassword, {
      resetTicket,
      newPassword: "Password@1",
      confirmPassword: "Password@1",
    });
    const weak = runValidator(validators.authResetPassword, {
      resetTicket,
      newPassword: "weak",
      confirmPassword: "weak",
    });
    const mismatch = runValidator(validators.authResetPassword, {
      resetTicket,
      newPassword: "Password@1",
      confirmPassword: "Password@2",
    });

    assert.equal(valid.nextCalled, true);
    assert.equal(weak.statusCode, 400);
    assert.equal(mismatch.statusCode, 400);
  });
});

describe("password reset audit log", () => {
  test("uses an email fingerprint and never logs reset secrets", () => {
    const email = "user@example.com";
    const resetTicket = passwordReset.generateResetTicket();
    const originalConsoleInfo = console.info;
    let output = "";
    console.info = (value) => {
      output = value;
    };

    try {
      writePasswordResetAudit(
        { ip: "127.0.0.1", get: () => "test-agent" },
        "password_reset",
        {
          outcome: "success",
          emailFingerprint: getEmailFingerprint(email),
        },
      );
    } finally {
      console.info = originalConsoleInfo;
    }

    assert.match(output, /^\[AUDIT\] /);
    assert.equal(output.includes(email), false);
    assert.equal(output.includes(resetTicket), false);
    assert.equal(output.includes("Password@1"), false);
  });
});
