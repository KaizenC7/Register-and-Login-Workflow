const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");

const {
  createUser,
  findUserByEmail,
  getUser,
} = require("./store");
const {
  createOtpChallenge,
  verifyOtpChallenge,
  invalidateChallenge,
  VerifyResult,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
} = require("./otp");
const { validateRegistration, passwordRules } = require("./validators");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const secondsFromNow = (ms) => Math.max(Math.round((ms - Date.now()) / 1000), 0);

// Track the "pending mobile" a user submitted during registration so we can
// simulate SMS delivery even though the phone number lives only on the user record.
function challengePublicView(challenge) {
  return {
    challengeId: challenge.challengeId,
    channel: challenge.channel,
    expiresIn: secondsFromNow(challenge.expiresAt),
    resendAvailableIn: secondsFromNow(challenge.resendAvailableAt),
    maxAttempts: challenge.maxAttempts,
  };
}

/* ------------------------------------------------------------------ */
/* POST /api/register                                                  */
/* ------------------------------------------------------------------ */
app.post("/api/register", async (req, res) => {
  const { fullName, email, mobile, password, agreeToTerms } = req.body || {};

  const { valid, errors } = validateRegistration({ fullName, email, mobile, password, agreeToTerms });
  if (!valid) {
    return res.status(400).json({ error: "validation_failed", fields: errors });
  }

  if (findUserByEmail(email)) {
    return res.status(409).json({ error: "email_taken", fields: { email: "An account with this email already exists." } });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = createUser({ fullName: fullName.trim(), email, mobile, passwordHash });

  const challenge = createOtpChallenge({
    userId: user.id,
    channel: "email",
    destination: user.email,
    purpose: "registration",
  });

  return res.status(201).json({
    userId: user.id,
    email: user.email,
    mobile: user.mobile,
    mfaRequired: true,
    method: "email",
    ...challengePublicView(challenge),
  });
});

/* ------------------------------------------------------------------ */
/* Email OTP                                                          */
/* ------------------------------------------------------------------ */
app.post("/api/send-email-otp", (req, res) => {
  const { userId } = req.body || {};
  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const challenge = createOtpChallenge({
    userId: user.id,
    channel: "email",
    destination: user.email,
    purpose: "registration",
  });

  return res.status(200).json({ method: "email", ...challengePublicView(challenge) });
});

app.post("/api/verify-email-otp", (req, res) => {
  const { challengeId, code, userId } = req.body || {};
  const outcome = verifyOtpChallenge({ challengeId, code, channel: "email" });

  switch (outcome.result) {
    case VerifyResult.OK: {
      const user = getUser(outcome.challenge.userId);
      if (user) user.emailVerified = true;
      return res.status(200).json({ verified: true, emailVerified: true, next: "sms" });
    }
    case VerifyResult.EXPIRED:
      return res.status(410).json({ verified: false, expired: true });
    case VerifyResult.LOCKED:
      return res.status(423).json({ verified: false, locked: true, attemptsRemaining: 0 });
    case VerifyResult.ALREADY_CONSUMED:
      return res.status(409).json({ verified: false, error: "code_already_used" });
    case VerifyResult.WRONG_CODE:
      return res.status(400).json({ verified: false, attemptsRemaining: outcome.attemptsRemaining });
    default:
      return res.status(404).json({ verified: false, error: "challenge_not_found" });
  }
});

/* ------------------------------------------------------------------ */
/* SMS OTP                                                            */
/* ------------------------------------------------------------------ */
app.post("/api/send-sms-otp", (req, res) => {
  const { userId } = req.body || {};
  const user = getUser(userId);
  if (!user) return res.status(404).json({ error: "user_not_found" });
  if (!user.emailVerified) {
    return res.status(400).json({ error: "email_not_verified" });
  }

  const challenge = createOtpChallenge({
    userId: user.id,
    channel: "sms",
    destination: user.mobile,
    purpose: "registration",
  });

  return res.status(200).json({ method: "sms", ...challengePublicView(challenge) });
});

app.post("/api/verify-sms-otp", (req, res) => {
  const { challengeId, code } = req.body || {};
  const outcome = verifyOtpChallenge({ challengeId, code, channel: "sms" });

  switch (outcome.result) {
    case VerifyResult.OK: {
      const user = getUser(outcome.challenge.userId);
      if (user) {
        user.mobileVerified = true;
        user.mfaEnabled = true;
      }
      return res.status(200).json({
        verified: true,
        mobileVerified: true,
        mfaEnabled: true,
        registrationComplete: true,
      });
    }
    case VerifyResult.EXPIRED:
      return res.status(410).json({ verified: false, expired: true });
    case VerifyResult.LOCKED:
      return res.status(423).json({ verified: false, locked: true, attemptsRemaining: 0 });
    case VerifyResult.ALREADY_CONSUMED:
      return res.status(409).json({ verified: false, error: "code_already_used" });
    case VerifyResult.WRONG_CODE:
      return res.status(400).json({ verified: false, attemptsRemaining: outcome.attemptsRemaining });
    default:
      return res.status(404).json({ verified: false, error: "challenge_not_found" });
  }
});

/* ------------------------------------------------------------------ */
/* Authenticator setup                                                */
/* ------------------------------------------------------------------ */
app.post("/api/mfa-setup", async (req, res) => {
  const user = getUser(req.body?.userId);
  if (!user) return res.status(404).json({ error: "user_not_found" });
  if (!user.mobileVerified) return res.status(400).json({ error: "mobile_not_verified" });

  const label = encodeURIComponent(`SecureID:${user.email}`);
  const issuer = encodeURIComponent("SecureID");
  const otpauth = `otpauth://totp/${label}?secret=${user.mfaSecret}&issuer=${issuer}`;
  const qrDataUrl = await QRCode.toDataURL(otpauth, { margin: 1, width: 190 });
  return res.json({ qrDataUrl, setupKey: user.mfaSecret });
});

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
app.get("/api/password-rules", (req, res) => {
  res.json({ rules: Object.keys(passwordRules("")) });
});

app.get("/health", (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SecureID registration backend running on http://localhost:${PORT}`);
    console.log(`OTP TTL: ${OTP_TTL_MS / 1000}s | Resend cooldown: ${RESEND_COOLDOWN_MS / 1000}s`);
  });
}

module.exports = app;
