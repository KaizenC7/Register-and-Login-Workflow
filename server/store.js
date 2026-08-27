// In-memory storage — for demo/assignment purposes only.
// In production this would be a real database.

const crypto = require("crypto");

const users = new Map();       // userId -> user record
const challenges = new Map();  // challengeId -> OTP challenge record

let userSeq = 1;

function createUser({ fullName, email, mobile, passwordHash }) {
  const id = `usr_${userSeq++}_${Date.now().toString(36)}`;
  const user = {
    id,
    fullName,
    email: email.toLowerCase(),
    mobile,
    passwordHash,
    emailVerified: false,
    mobileVerified: false,
    mfaEnabled: false,
    mfaSecret: crypto.randomBytes(20).toString("hex").slice(0, 32).toUpperCase(),
    createdAt: new Date().toISOString(),
    failedLoginAttempts: 0,
    lockedUntil: null,
  };
  users.set(id, user);
  return user;
}

function findUserByEmail(email) {
  const target = (email || "").toLowerCase();
  for (const user of users.values()) {
    if (user.email === target) return user;
  }
  return null;
}

function getUser(userId) {
  return users.get(userId) || null;
}

function saveChallenge(challenge) {
  challenges.set(challenge.challengeId, challenge);
  return challenge;
}

function getChallenge(challengeId) {
  return challenges.get(challengeId) || null;
}

function deleteChallenge(challengeId) {
  challenges.delete(challengeId);
}

module.exports = {
  users,
  challenges,
  createUser,
  findUserByEmail,
  getUser,
  saveChallenge,
  getChallenge,
  deleteChallenge,
};
