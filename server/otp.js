const crypto = require("crypto");
const { saveChallenge, getChallenge, deleteChallenge } = require("./store");

const OTP_LENGTH = 6;
const OTP_TTL_MS = 3 * 60 * 1000; // 3 minutes
const MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN_MS = 25 * 1000; // 25 seconds, matches UI resend timer

function generateOtp() {
  // 6-digit numeric OTP, generated server-side only.
  const otp = crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
  return otp;
}

function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function newChallengeId() {
  return `chg_${crypto.randomBytes(12).toString("hex")}`;
}

/**
 * Creates a fresh OTP challenge for a given user + channel (email|sms),
 * "sends" it (simulated via console log), and persists it.
 */
function createOtpChallenge({ userId, channel, destination, purpose }) {
  const otp = generateOtp();
  const challengeId = newChallengeId();
  const now = Date.now();

  const challenge = {
    challengeId,
    userId,
    channel,          // "email" | "sms"
    purpose,          // "registration" | "login"
    otpHash: hashOtp(otp),
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    resendAvailableAt: now + RESEND_COOLDOWN_MS,
    consumed: false,
    locked: false,
  };

  saveChallenge(challenge);
  simulateDelivery({ channel, destination, otp });

  return challenge;
}

function simulateDelivery({ channel, destination, otp }) {
  if (channel === "email") {
    console.log(
      `\n[SIMULATED EMAIL]\nTo: ${destination}\nSubject: Your verification code\nOTP: ${otp}\n(expires in ${OTP_TTL_MS / 1000}s)\n`
    );
  } else if (channel === "sms") {
    console.log(
      `\n[SIMULATED SMS]\nTo: ${destination}\nMessage: Your verification code is ${otp}. It expires in ${OTP_TTL_MS / 60000} minutes.\n`
    );
  }
}

const VerifyResult = Object.freeze({
  OK: "OK",
  NOT_FOUND: "NOT_FOUND",
  ALREADY_CONSUMED: "ALREADY_CONSUMED",
  EXPIRED: "EXPIRED",
  LOCKED: "LOCKED",
  WRONG_CODE: "WRONG_CODE",
});

/**
 * Verifies a submitted code against a stored challenge.
 * Returns { result, attemptsRemaining, challenge }
 */
function verifyOtpChallenge({ challengeId, code, channel }) {
  const challenge = getChallenge(challengeId);

  if (!challenge || (channel && challenge.channel !== channel)) {
    return { result: VerifyResult.NOT_FOUND, attemptsRemaining: 0, challenge: null };
  }
  if (challenge.consumed) {
    return { result: VerifyResult.ALREADY_CONSUMED, attemptsRemaining: 0, challenge };
  }
  if (challenge.locked) {
    return { result: VerifyResult.LOCKED, attemptsRemaining: 0, challenge };
  }
  if (Date.now() > challenge.expiresAt) {
    return { result: VerifyResult.EXPIRED, attemptsRemaining: 0, challenge };
  }

  const submittedHash = hashOtp(String(code || "").trim());
  const isMatch =
    submittedHash.length === challenge.otpHash.length &&
    crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(challenge.otpHash));

  if (isMatch) {
    challenge.consumed = true; // single-use: invalidate immediately on success
    saveChallenge(challenge);
    return { result: VerifyResult.OK, attemptsRemaining: challenge.maxAttempts - challenge.attempts, challenge };
  }

  challenge.attempts += 1;
  const attemptsRemaining = Math.max(challenge.maxAttempts - challenge.attempts, 0);
  if (attemptsRemaining <= 0) {
    challenge.locked = true;
  }
  saveChallenge(challenge);

  return {
    result: challenge.locked ? VerifyResult.LOCKED : VerifyResult.WRONG_CODE,
    attemptsRemaining,
    challenge,
  };
}

function invalidateChallenge(challengeId) {
  deleteChallenge(challengeId);
}

module.exports = {
  OTP_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
  createOtpChallenge,
  verifyOtpChallenge,
  invalidateChallenge,
  VerifyResult,
};
