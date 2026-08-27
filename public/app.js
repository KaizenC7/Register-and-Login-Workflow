(() => {
  "use strict";

  const API_BASE = (document.querySelector('meta[name="secureid-api-base"]')?.content || "").replace(/\/$/, "");

  const screens = {};
  const progressLabels = document.querySelectorAll(".step-label");
  const webStepLabel = document.getElementById("web-step-label");
  document.querySelectorAll("[data-screen]").forEach((el) => {
    screens[el.dataset.screen] = el;
  });

  function showScreen(name) {
    Object.values(screens).forEach((el) => (el.hidden = true));
    screens[name].hidden = false;
    if (name === "register") setSteps(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setSteps(activeCount, pageDescription) {
    const description = pageDescription || (activeCount === 1
      ? "1. Register - Details"
      : activeCount === 2
        ? "2. Email Verification - OTP"
        : "3. Mobile Verification - OTP");
    progressLabels.forEach((label) => (label.textContent = description));
    webStepLabel.textContent = description;
    document.querySelectorAll(".steps .step").forEach((step) => {
      const stepNumber = Number(step.dataset.step);
      step.classList.toggle("done", stepNumber < activeCount);
      step.classList.toggle("active", stepNumber === activeCount);
    });
    document.querySelectorAll(".steps .step-line").forEach((line, i) => {
      line.classList.toggle("done", i < activeCount - 1);
    });
  }

  // Registration-journey state carried across screens.
  const state = {
    userId: null,
    email: null,
    mobile: null,
    channel: null,       // "email" | "sms"
    challengeId: null,
    expiresAt: null,      // epoch ms
    resendAt: null,       // epoch ms
    timers: { expire: null, resend: null },
  };

  /* ================= Registration form ================= */

  const registerForm = document.getElementById("register-form");
  const registerAlert = document.getElementById("register-alert");
  const passwordInput = registerForm.password;
  const checklistItems = document.querySelectorAll("#pw-checklist li");

  const passwordRuleTests = {
    length: (pw) => pw.length >= 8,
    uppercase: (pw) => /[A-Z]/.test(pw),
    number: (pw) => /[0-9]/.test(pw),
    special: (pw) => /[^A-Za-z0-9]/.test(pw),
  };

  passwordInput.addEventListener("input", () => {
    const pw = passwordInput.value;
    checklistItems.forEach((li) => {
      const rule = li.dataset.rule;
      li.classList.toggle("met", passwordRuleTests[rule](pw));
    });
  });

  document.getElementById("toggle-password").addEventListener("click", (e) => {
    const isPw = passwordInput.type === "password";
    passwordInput.type = isPw ? "text" : "password";
    e.currentTarget.textContent = isPw ? "🙈" : "👁";
  });

  function clearFieldErrors() {
    document.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
    document.querySelectorAll(".field input").forEach((el) => el.classList.remove("invalid"));
    registerAlert.hidden = true;
    registerAlert.textContent = "";
  }

  function showFieldErrors(fields) {
    Object.entries(fields || {}).forEach(([name, message]) => {
      const small = document.querySelector(`[data-error-for="${name}"]`);
      if (small) small.textContent = message;
      const input = registerForm.querySelector(`[name="${name}"]`);
      if (input) input.classList.add("invalid");
    });
  }

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFieldErrors();

    const fullName = registerForm.fullName.value.trim();
    const email = registerForm.email.value.trim();
    const mobile = "+91" + registerForm.mobile.value.replace(/\s+/g, "");
    const password = registerForm.password.value;
    const agreeToTerms = registerForm.agreeToTerms.checked;

    const submitBtn = document.getElementById("register-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";

    try {
      const res = await fetch(`${API_BASE}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, mobile, password, agreeToTerms }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.fields) showFieldErrors(data.fields);
        else {
          registerAlert.hidden = false;
          registerAlert.textContent = data.error === "email_taken"
            ? "An account with this email already exists."
            : "Something went wrong. Please try again.";
        }
        return;
      }

      state.userId = data.userId;
      state.email = data.email;
      state.mobile = mobile;

      enterOtpScreen({
        channel: "email",
        challengeId: data.challengeId,
        expiresIn: data.expiresIn,
        resendAvailableIn: data.resendAvailableIn,
      });
    } catch (err) {
      registerAlert.hidden = false;
      registerAlert.textContent = "Could not reach the server. Please try again.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account";
    }
  });

  document.getElementById("go-to-login-link").addEventListener("click", (e) => {
    e.preventDefault();
    showScreen("login");
  });
  document.getElementById("back-to-register").addEventListener("click", () => {
    showScreen("register");
  });

  /* ================= OTP screen (shared: email + sms) ================= */

  const otpBoxes = Array.from(document.querySelectorAll(".otp-box"));
  const otpIcon = document.getElementById("otp-icon");
  const otpTitle = document.getElementById("otp-title");
  const otpDestination = document.getElementById("otp-destination");
  const otpStatus = document.getElementById("otp-status");
  const otpTimerWrap = document.getElementById("otp-timer");
  const otpCountdownEl = document.getElementById("otp-countdown");
  const resendBtn = document.getElementById("otp-resend-btn");
  const resendCountdownEl = document.getElementById("resend-countdown");
  const changeDetailEl = document.getElementById("otp-change-detail");

  function fmtMMSS(totalSeconds) {
    const s = Math.max(totalSeconds, 0);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function clearOtpBoxes() {
    otpBoxes.forEach((box) => {
      box.value = "";
      box.classList.remove("error");
      box.disabled = false;
    });
    otpBoxes[0].focus();
  }

  function readOtpCode() {
    return otpBoxes.map((b) => b.value).join("");
  }

  function setOtpError(message) {
    otpStatus.classList.remove("info");
    otpStatus.textContent = message;
    otpBoxes.forEach((b) => b.classList.add("error"));
  }

  function setOtpInfo(message) {
    otpStatus.classList.add("info");
    otpStatus.textContent = message;
  }

  function clearOtpMessage() {
    otpStatus.textContent = "";
    otpStatus.classList.remove("info");
  }

  document.getElementById("otp-back-btn").addEventListener("click", () => {
    stopTimers();
    showScreen("register");
  });

  otpBoxes.forEach((box, idx) => {
    box.addEventListener("input", () => {
      box.value = box.value.replace(/[^0-9]/g, "").slice(0, 1);
      box.classList.remove("error");
      if (box.value && idx < otpBoxes.length - 1) {
        otpBoxes[idx + 1].focus();
      }
      if (readOtpCode().length === otpBoxes.length) {
        submitOtp();
      }
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && idx > 0) {
        otpBoxes[idx - 1].focus();
      }
    });

    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData.getData("text") || "").replace(/[^0-9]/g, "");
      if (!text) return;
      text.split("").forEach((digit, i) => {
        if (otpBoxes[i]) otpBoxes[i].value = digit;
      });
      const last = Math.min(text.length, otpBoxes.length) - 1;
      if (last >= 0) otpBoxes[last].focus();
      if (readOtpCode().length === otpBoxes.length) submitOtp();
    });
  });

  function stopTimers() {
    clearInterval(state.timers.expire);
    clearInterval(state.timers.resend);
  }

  function startExpiryTimer() {
    clearInterval(state.timers.expire);
    otpTimerWrap.classList.remove("expired");
    state.timers.expire = setInterval(() => {
      const secondsLeft = Math.round((state.expiresAt - Date.now()) / 1000);
      if (secondsLeft <= 0) {
        otpCountdownEl.textContent = "00:00";
        otpTimerWrap.classList.add("expired");
        otpTimerWrap.firstChild.textContent = "This code has expired. ";
        clearInterval(state.timers.expire);
        otpBoxes.forEach((b) => (b.disabled = true));
        setOtpError("Your code has expired. Request a new one to continue.");
        return;
      }
      otpCountdownEl.textContent = fmtMMSS(secondsLeft);
    }, 250);
  }

  function startResendTimer() {
    clearInterval(state.timers.resend);
    resendBtn.disabled = true;
    state.timers.resend = setInterval(() => {
      const secondsLeft = Math.round((state.resendAt - Date.now()) / 1000);
      if (secondsLeft <= 0) {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend Code";
        clearInterval(state.timers.resend);
        return;
      }
      resendCountdownEl.textContent = fmtMMSS(secondsLeft);
      resendBtn.innerHTML = `Resend Code (<span id="resend-countdown">${fmtMMSS(secondsLeft)}</span>)`;
    }, 250);
  }

  function enterOtpScreen({ channel, challengeId, expiresIn, resendAvailableIn, maxAttemptsMessage }) {
    stopTimers();
    state.channel = channel;
    state.challengeId = challengeId;
    state.expiresAt = Date.now() + expiresIn * 1000;
    state.resendAt = Date.now() + resendAvailableIn * 1000;

    otpTimerWrap.firstChild.textContent = "Code expires in ";
    otpTimerWrap.classList.remove("expired");
    clearOtpMessage();
    clearOtpBoxes();
    changeDetailEl.hidden = true;

    if (channel === "email") {
      otpIcon.className = "icon-badge";
      otpIcon.textContent = "✉";
      otpTitle.textContent = "Verify your email";
      otpDestination.textContent = state.email;
      setSteps(2, "2. Email Verification - OTP");
    } else {
      otpIcon.className = "icon-badge phone";
      otpIcon.textContent = "📱";
      otpTitle.textContent = "Verify your mobile";
      otpDestination.textContent = state.mobile;
      setSteps(3, "3. Mobile Verification - OTP");
    }

    if (maxAttemptsMessage) {
      setOtpError(maxAttemptsMessage);
      otpBoxes.forEach((b) => (b.disabled = true));
    }

    showScreen("otp");
    startExpiryTimer();
    startResendTimer();
  }

  async function submitOtp() {
    const code = readOtpCode();
    if (code.length !== otpBoxes.length) return;

    otpBoxes.forEach((b) => (b.disabled = true));
    clearOtpMessage();

    const endpoint = state.channel === "email" ? "/api/verify-email-otp" : "/api/verify-sms-otp";

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: state.challengeId, code, userId: state.userId }),
      });
      const data = await res.json();

      if (res.ok && data.verified) {
        stopTimers();
        if (state.channel === "email") {
          await advanceToSmsOtp();
        } else {
            await showAuthenticatorSetup();
        }
        return;
      }

      if (data.expired) {
        clearInterval(state.timers.expire);
        otpTimerWrap.classList.add("expired");
        otpTimerWrap.firstChild.textContent = "This code has expired. ";
        setOtpError("This code has expired. Please request a new one.");
        otpBoxes.forEach((b) => (b.disabled = true));
        return;
      }

      if (data.locked) {
        clearInterval(state.timers.expire);
        setOtpError("Maximum attempts reached. Please request a new code.");
        otpBoxes.forEach((b) => (b.disabled = true));
        return;
      }

      // Wrong code
      const remaining = data.attemptsRemaining;
      const plural = remaining === 1 ? "attempt" : "attempts";
      setOtpError(`Incorrect code. Please try again. You have ${remaining} ${plural} left.`);
      otpBoxes.forEach((b) => {
        b.disabled = false;
        b.value = "";
      });
      otpBoxes[0].focus();
    } catch (err) {
      setOtpError("Could not reach the server. Please try again.");
      otpBoxes.forEach((b) => (b.disabled = false));
    }
  }

  async function advanceToSmsOtp() {
    setOtpInfo("Email verified. Sending code to your mobile…");
    try {
      const res = await fetch(`${API_BASE}/api/send-sms-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: state.userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "sms_send_failed");

      enterOtpScreen({
        channel: "sms",
        challengeId: data.challengeId,
        expiresIn: data.expiresIn,
        resendAvailableIn: data.resendAvailableIn,
      });
    } catch (err) {
      setOtpError("Could not send the mobile verification code. Please try again.");
    }
  }

  async function showAuthenticatorSetup() {
    setSteps(4, "5. Authenticator Setup");
    const qrImage = document.getElementById("setup-qr");
    try {
      const res = await fetch(`${API_BASE}/api/mfa-setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: state.userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "mfa_setup_failed");
      qrImage.src = data.qrDataUrl;
      document.getElementById("setup-key").dataset.key = data.setupKey;
      showScreen("setup");
    } catch (err) {
      setOtpError("Could not prepare authenticator setup. Please try again.");
      showScreen("otp");
    }
  }

  function returnToOtp() {
    showScreen("otp");
  }

  document.getElementById("setup-back-btn").addEventListener("click", returnToOtp);
  document.getElementById("setup-web-back-btn").addEventListener("click", returnToOtp);

  document.getElementById("setup-key").addEventListener("click", (e) => {
    const key = e.currentTarget.dataset.key;
    e.currentTarget.textContent = key ? `Setup key: ${key}` : "Setup key unavailable";
  });

  document.getElementById("setup-continue").addEventListener("click", () => {
    setSteps(5, "7. Registration Success");
    showScreen("success");
  });

  document.getElementById("otp-secondary-link").addEventListener("click", (e) => {
    e.preventDefault();
    if (!resendBtn.disabled) resendBtn.click();
  });

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true;
    const endpoint = state.channel === "email" ? "/api/send-email-otp" : "/api/send-sms-otp";
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: state.userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error("resend_failed");

      enterOtpScreen({
        channel: state.channel,
        challengeId: data.challengeId,
        expiresIn: data.expiresIn,
        resendAvailableIn: data.resendAvailableIn,
      });
      setOtpInfo("A new code has been sent.");
    } catch (err) {
      setOtpError("Could not resend the code. Please try again.");
      resendBtn.disabled = false;
    }
  });

  /* ================= Success ================= */

  document.getElementById("continue-to-login").addEventListener("click", () => {
    showScreen("login");
  });

  /* ================= Init ================= */

  showScreen("register");
})();