# Sudheer Bandi Portfolio — Authentication + Email MFA

The portfolio now opens on a sign-in screen. The private portfolio page is revealed only after the backend verifies the password and a one-time email code.

## Authentication flow

1. `POST /api/auth/login` checks the account in PostgreSQL and verifies the password with bcrypt.
2. The backend generates a cryptographically random 6-digit code, stores only its HMAC hash with a 10-minute expiry, and emails the code using Resend.
3. `POST /api/auth/verify-mfa` checks expiry, limits incorrect attempts, compares hashes in constant time, and only then creates a verified server-side session.
4. `GET /api/auth/me` checks the session when the page loads or refreshes.
5. `POST /api/auth/resend-code` sends a new code and invalidates the previous one.
6. `POST /api/auth/logout` destroys the session.

Passwords are hashed using bcrypt. Session cookies are HttpOnly, SameSite=Lax and Secure in production. Authentication endpoints are rate-limited. There is no public sign-up endpoint; the initial private account is created from environment variables.

## Deploy to Render

1. Push this project to your GitHub repository (without any `.env` file or secrets).
2. In Render, choose **New → Blueprint** and select the repository containing `render.yaml`. Render will create the Node web service and PostgreSQL database.
3. In the web service's Environment settings, set:
   - `ADMIN_EMAIL`: the email address you will sign in with.
   - `ADMIN_PASSWORD`: a unique password of at least 12 characters.
   - `RESEND_API_KEY`: your API key from Resend.
   - `RESEND_FROM`: a sender address/domain verified in Resend, e.g. `Portfolio Security <security@your-verified-domain.com>`.
4. Deploy/redeploy. The backend creates the tables automatically and creates the first admin account if it does not exist.
5. Open the Render web-service URL. Enter `ADMIN_EMAIL` and `ADMIN_PASSWORD`; then enter the email code to open the portfolio.
6. Test `/api/health` on the deployed domain; it should return `{"status":"ok"}`.

**Resend note:** Verify the sending domain in Resend before production use. Resend's test sender may only deliver to permitted/verified recipients, depending on account setup.

## Local development

Requirements: Node.js 20+ and PostgreSQL.

1. Create a PostgreSQL database, for example `portfolio`.
2. Copy `backend/.env.example` to `backend/.env` and fill in the values. Use a long random `SESSION_SECRET` and a different long random `MFA_SECRET`.
3. From the `backend` directory, run `npm install`, then `npm start`.
4. Visit `http://localhost:3000`.

For local email delivery, use a valid Resend API key and verified sender. Never commit `.env`, real API keys, passwords, or session secrets.

## Important configuration details

- `ADMIN_EMAIL` and `ADMIN_PASSWORD` are used only to create the initial account if that email is not already present. Changing those environment variables later does not automatically update an existing account's password.
- If you lose access to the admin password, reset it securely in the database using a bcrypt hash or implement a controlled password-reset flow before exposing the site publicly.
- Use Render's persistent PostgreSQL database, not SQLite or a local file, for deployed user and session data.
- The login is intentionally private: there is no public registration page.
