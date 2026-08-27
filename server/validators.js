const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[0-9]{7,15}$/;

function passwordRules(password) {
  const pw = password || "";
  return {
    length: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

function passwordIsValid(password) {
  const rules = passwordRules(password);
  return Object.values(rules).every(Boolean);
}

function validateRegistration({ fullName, email, mobile, password, agreeToTerms }) {
  const errors = {};

  if (!fullName || !fullName.trim()) {
    errors.fullName = "Full name is required.";
  }

  if (!email || !EMAIL_RE.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!mobile || !MOBILE_RE.test(mobile)) {
    errors.mobile = "Enter a valid mobile number.";
  }

  if (!passwordIsValid(password)) {
    errors.password = "Password does not meet the requirements.";
  }

  if (agreeToTerms !== true) {
    errors.agreeToTerms = "You must accept the Terms & Conditions and Privacy Policy.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

module.exports = { validateRegistration, passwordRules, passwordIsValid, EMAIL_RE, MOBILE_RE };
