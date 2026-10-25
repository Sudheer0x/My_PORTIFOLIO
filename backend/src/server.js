'use strict';

require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const frontendDir = path.resolve(__dirname, '../..');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false
});

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Configure a PostgreSQL database before starting.');
  process.exit(1);
}
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is required in production.');
  process.exit(1);
}

app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '10kb' }));

app.use(session({
  name: 'portfolio.sid',
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'local-development-only-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes and try again.' } });
const verifyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many verification attempts. Request a new code and try again.' } });

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS mfa_challenges (
      user_id BIGINT PRIMARY KEY REFERENCES portfolio_users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS mfa_challenges_expiry_idx ON mfa_challenges(expires_at);
  `);

  // Create the private portfolio account from Render environment variables once.
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (email && password) {
    if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
    const existing = await pool.query('SELECT id FROM portfolio_users WHERE email = $1', [email]);
    if (existing.rowCount === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query('INSERT INTO portfolio_users (email, password_hash) VALUES ($1, $2)', [email, passwordHash]);
      console.log('Initial portfolio account created from ADMIN_EMAIL.');
    }
  } else {
    console.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set: no initial login account will be created.');
  }
}

function hashCode(code) {
  return crypto.createHmac('sha256', process.env.MFA_SECRET || process.env.SESSION_SECRET || 'local-development-only-change-me')
    .update(code).digest('hex');
}
function safeEqualHex(a, b) {
  const aa = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function sendMfaEmail(email, code) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    throw new Error('Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM.');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [email],
      subject: 'Your portfolio sign-in verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes. If you did not try to sign in, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a"><h2>Sign-in verification</h2><p>Use this one-time code to finish signing in to the portfolio:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. Never share it with anyone.</p></div>`
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Resend email error:', response.status, detail.slice(0, 500));
    throw new Error('We could not send the verification email. Check your email configuration and try again.');
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userId || !req.session.mfaVerified) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length > 200) {
      return res.status(400).json({ error: 'Enter a valid email address and password.' });
    }
    const result = await pool.query('SELECT id, email, password_hash FROM portfolio_users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = hashCode(code);
    await pool.query(`INSERT INTO mfa_challenges (user_id, code_hash, expires_at, attempts, created_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes', 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at, attempts = 0, created_at = NOW()`, [user.id, codeHash]);

    try {
      await sendMfaEmail(user.email, code);
    } catch (emailError) {
      await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1', [user.id]);
      return res.status(503).json({ error: emailError.message });
    }

    req.session.pendingUserId = String(user.id);
    req.session.userId = null;
    req.session.mfaVerified = false;
    return res.json({ mfaRequired: true, message: 'Verification code sent. Check your email.' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to sign in right now. Please try again.' });
  }
});

app.post('/api/auth/verify-mfa', verifyLimiter, async (req, res) => {
  try {
    const userId = req.session.pendingUserId;
    const code = String(req.body?.code || '').trim();
    if (!userId) return res.status(401).json({ error: 'Your sign-in session expired. Please sign in again.' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });

    const result = await pool.query('SELECT code_hash, expires_at, attempts FROM mfa_challenges WHERE user_id = $1', [userId]);
    const challenge = result.rows[0];
    if (!challenge || new Date(challenge.expires_at).getTime() <= Date.now()) {
      await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
      return res.status(401).json({ error: 'That code expired. Please sign in again to get a new one.' });
    }
    if (challenge.attempts >= 5) {
      await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
      delete req.session.pendingUserId;
      return res.status(429).json({ error: 'Too many incorrect codes. Please sign in again.' });
    }
    if (!safeEqualHex(hashCode(code), challenge.code_hash)) {
      await pool.query('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE user_id = $1', [userId]);
      return res.status(401).json({ error: 'That verification code is incorrect.' });
    }

    await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1', [userId]);
    await pool.query('UPDATE portfolio_users SET last_login_at = NOW() WHERE id = $1', [userId]);
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.userId = userId;
    req.session.mfaVerified = true;
    return res.json({ authenticated: true, message: 'Verification successful.' });
  } catch (error) {
    console.error('MFA verification error:', error);
    return res.status(500).json({ error: 'Unable to verify the code right now.' });
  }
});

app.post('/api/auth/resend-code', authLimiter, async (req, res) => {
  try {
    const userId = req.session.pendingUserId;
    if (!userId) return res.status(401).json({ error: 'Your sign-in session expired. Please sign in again.' });
    const userResult = await pool.query('SELECT email FROM portfolio_users WHERE id = $1', [userId]);
    if (!userResult.rows[0]) return res.status(401).json({ error: 'Please sign in again.' });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await pool.query(`INSERT INTO mfa_challenges (user_id, code_hash, expires_at, attempts, created_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes', 0, NOW())
      ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash,
      expires_at = EXCLUDED.expires_at, attempts = 0, created_at = NOW()`, [userId, hashCode(code)]);
    await sendMfaEmail(userResult.rows[0].email, code);
    return res.json({ message: 'A new verification code has been sent.' });
  } catch (error) {
    console.error('Resend code error:', error);
    return res.status(503).json({ error: 'Could not resend the code. Please try again shortly.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT email FROM portfolio_users WHERE id = $1', [req.session.userId]);
  if (!result.rows[0]) return res.status(401).json({ error: 'Please sign in again.' });
  res.json({ authenticated: true, email: result.rows[0].email });
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const pendingUserId = req.session.pendingUserId;
    if (pendingUserId) await pool.query('DELETE FROM mfa_challenges WHERE user_id = $1', [pendingUserId]);
    req.session.destroy(() => {
      res.clearCookie('portfolio.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
      res.json({ message: 'Signed out.' });
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Unable to sign out cleanly.' });
  }
});

// Serve the existing portfolio only through this same-origin backend.
app.use(express.static(frontendDir, { index: 'index.html', dotfiles: 'deny' }));
app.get('*', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

initializeDatabase().then(() => {
  app.listen(port, () => console.log(`Portfolio server listening on port ${port}`));
}).catch(error => {
  console.error('Startup failed:', error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
