# SecureID — Registration Journey

Implements the **Registration** flow from the IAM Authentication & Registration
guidelines: Registration form → Email OTP → SMS OTP → MFA enabled →
Registration Success, backed by a Node.js/Express API and a vanilla
HTML/CSS/JS frontend.

## Run it

```bash
cd server
npm install
npm start
```

Then open **http://localhost:3000** (Express serves the frontend from `/public`
and the API from the same origin, so there's nothing else to configure).

OTPs are simulated — instead of sending real email/SMS, the backend prints
the code to the server console:

```
[SIMULATED EMAIL]
To: priya.sharma@email.com
OTP: 482913
```

Watch the terminal running `npm start` to grab the code while testing.

## What's implemented

**Frontend** (`/public`) — matches the reference mockups:
- Registration form with live password-rule checklist, inline field errors
- Shared OTP screen (reused for both email + mobile) with 6-box input,
  auto-advance/paste support, live countdown, wrong-code / expired / max-attempts
  states, and a resend button with its own cooldown
- Registration success screen

**Backend** (`/server`):
- `POST /api/register` — validates input, hashes the password (bcrypt),
  creates the user, generates an email OTP challenge
- `POST /api/send-email-otp`, `POST /api/verify-email-otp`
- `POST /api/send-sms-otp`, `POST /api/verify-sms-otp` — verifying SMS marks
  the account `mobileVerified` + `mfaEnabled` and completes registration
- OTPs are 6 digits, generated with `crypto.randomInt` server-side only,
  stored as a SHA-256 hash (never the raw code), never returned in any
  API response
- Each OTP challenge has a 3-minute expiry, a 3-attempt limit, and is
  single-use (invalidated immediately on successful verification)
- Resending always issues a brand-new challenge (new code, new expiry,
  attempts reset) rather than reusing the old one

## Not in this slice

Login, sessions/cookies, and JWT-protected routes (sections 3–4 of the
guidelines) aren't built yet — the success screen links to a placeholder
Login screen so the next slice has somewhere to plug in.

## File map

```
server/
  server.js       Express app + all API routes
  otp.js          OTP generation, hashing, expiry/attempt/lockout logic
  store.js        In-memory user + challenge storage
  validators.js   Registration field + password-rule validation
public/
  index.html      All registration-journey screens
  styles.css      SecureID visual styling
  app.js          Screen state machine + API calls
```
