
'use strict';


require('dotenv').config();
const { log, requestLogger } = require('./logger');

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

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in production.');
}

if (isProduction && !process.env.RESEND_API_KEY) {
  console.warn('RESEND_API_KEY is not configured. MFA email delivery will fail.');
}

if (isProduction && !process.env.RESEND_FROM) {
  console.warn('RESEND_FROM is not configured. MFA email delivery will fail.');
}

const frontendOrigin = (
  process.env.FRONTEND_URL || 'https://sudheer0x.github.io'
).replace(/\/$/, '');


const allowedOrigins = new Set([
  frontendOrigin,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);


const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? false
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

app.disable('x-powered-by');

if (isProduction) {
  app.set('trust proxy', 1);
}

/*
 * CORS: allow the GitHub Pages frontend and local development.
 * The browser must use credentials: 'include' for session cookies.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type'
    );
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com'
        ],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'https://cdnjs.cloudflare.com',
          'data:'
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", frontendOrigin, 'https://my-portifolio-yyvo.onrender.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(express.json({ limit: '10kb' }));
app.use(requestLogger);

/*
 * Session configuration.
 * GitHub Pages and Render are different sites, so production cookies
 * need SameSite=None and Secure. Browser third-party-cookie policies
 * may still block this cross-site session arrangement.
 */
app.use(
  session({
    name: 'portfolio.sid',
    store: new pgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'local-development-only-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts. Please wait 15 minutes.'
  }
});

const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many verification attempts. Request a new code.'
  }
});

const resendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 4,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many resend requests. Please try again later.'
  }
});

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 254;
}

function hashCode(code) {
  const secret =
    process.env.MFA_SECRET ||
    process.env.SESSION_SECRET ||
    'local-development-only-change-me';

  return crypto
    .createHmac('sha256', secret)
    .update(code)
    .digest('hex');
}

function safeEqualHex(a, b) {
  const first = Buffer.from(a, 'hex');
  const second = Buffer.from(b, 'hex');

  return (
    first.length === second.length &&
    first.length > 0 &&
    crypto.timingSafeEqual(first, second)
  );
}

async function sendMfaEmail(email, code) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    throw new Error(
      'Email delivery is not configured. Check RESEND_API_KEY and RESEND_FROM.'
    );
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [email],
      subject: 'Your portfolio sign-in verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes. Never share this code.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0f172a">
          <h2>Sign-in verification</h2>
          <p>Use this code to complete your portfolio sign-in:</p>
          <p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p>
          <p>This code expires in 10 minutes. Never share it with anyone.</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Resend API error:', response.status, detail.slice(0, 300));
    throw new Error('Unable to send the verification email.');
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userId || !req.session.mfaVerified) {
    return res.status(401).json({
      error: 'Please sign in to continue.'
    });
  }

  next();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/*
 * Create database tables and optionally create the initial account.
 */
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
      user_id BIGINT PRIMARY KEY
        REFERENCES portfolio_users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS mfa_challenges_expiry_idx
      ON mfa_challenges(expires_at);
  `);

  const adminEmail = String(process.env.ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();

  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (adminEmail && adminPassword) {
    if (!validEmail(adminEmail)) {
      throw new Error('ADMIN_EMAIL is not a valid email address.');
    }

    if (adminPassword.length < 12 || adminPassword.length > 200) {
      throw new Error('ADMIN_PASSWORD must be between 12 and 200 characters.');
    }

    const existing = await pool.query(
      'SELECT id FROM portfolio_users WHERE email = $1',
      [adminEmail]
    );

    if (existing.rowCount === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);

      await pool.query(
        `INSERT INTO portfolio_users (email, password_hash)
         VALUES ($1, $2)`,
        [adminEmail, passwordHash]
      );

      console.log('Initial account created from ADMIN_EMAIL.');
    }
  }
}

/*
 * Health check.
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/*
 * Register a new account.
 * Registration does not automatically sign the user in.
 */
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || '');

    if (!validEmail(email)) {
      return res.status(400).json({
        error: 'Enter a valid email address.'
      });
    }

    if (password.length < 12 || password.length > 200) {
      return res.status(400).json({
        error: 'Password must be between 12 and 200 characters.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO portfolio_users (email, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, created_at`,
      [email, passwordHash]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: 'An account with this email already exists.'
      });
    }

    return res.status(201).json({
      message: 'Account created. Please sign in to verify your email.',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Registration error:', error.message);

    return res.status(500).json({
      error: 'Unable to create your account. Please try again.'
    });
  }
});

/*
 * Login with email and password.
 * A successful password check sends an MFA code.
 */
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();

    const password = String(req.body?.password || '');

    if (!validEmail(email) || !password || password.length > 200) {
      return res.status(400).json({
        error: 'Enter a valid email address and password.'
      });
    }

    const result = await pool.query(
      `SELECT id, email, password_hash
       FROM portfolio_users
       WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        error: 'Email or password is incorrect.'
      });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    await pool.query(
      `INSERT INTO mfa_challenges
        (user_id, code_hash, expires_at, attempts, created_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes', 0, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         created_at = NOW()`,
      [user.id, hashCode(code)]
    );

    try {
      await sendMfaEmail(user.email, code);
    } catch (emailError) {
      await pool.query(
        'DELETE FROM mfa_challenges WHERE user_id = $1',
        [user.id]
      );

      return res.status(503).json({
        error: emailError.message
      });
    }

    await regenerateSession(req);

    req.session.pendingUserId = String(user.id);
    req.session.mfaVerified = false;

    await saveSession(req);

    return res.json({
      mfaRequired: true,
      message: 'Verification code sent. Check your email.'
    });
  } catch (error) {
    console.error('Login error:', error.message);

    return res.status(500).json({
      error: 'Unable to sign in right now. Please try again.'
    });
  }
});

/*
 * Verify the MFA code.
 */
app.post('/api/auth/verify-mfa', verifyLimiter, async (req, res) => {
  try {
    const userId = req.session.pendingUserId;
    const code = String(req.body?.code || '').trim();

    if (!userId) {
      return res.status(401).json({
        error: 'Your sign-in session expired. Please sign in again.'
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        error: 'Enter the six-digit verification code.'
      });
    }

    const result = await pool.query(
      `SELECT code_hash, expires_at, attempts
       FROM mfa_challenges
       WHERE user_id = $1`,
      [userId]
    );

    const challenge = result.rows[0];

    if (
      !challenge ||
      new Date(challenge.expires_at).getTime() <= Date.now()
    ) {
      await pool.query(
        'DELETE FROM mfa_challenges WHERE user_id = $1',
        [userId]
      );

      return res.status(401).json({
        error: 'The code expired. Please sign in again.'
      });
    }

    if (challenge.attempts >= 5) {
      await pool.query(
        'DELETE FROM mfa_challenges WHERE user_id = $1',
        [userId]
      );

      delete req.session.pendingUserId;
      await saveSession(req);

      return res.status(429).json({
        error: 'Too many incorrect codes. Please sign in again.'
      });
    }

    if (!safeEqualHex(hashCode(code), challenge.code_hash)) {
      await pool.query(
        `UPDATE mfa_challenges
         SET attempts = attempts + 1
         WHERE user_id = $1`,
        [userId]
      );

      return res.status(401).json({
        error: 'The verification code is incorrect.'
      });
    }

    await pool.query(
      'DELETE FROM mfa_challenges WHERE user_id = $1',
      [userId]
    );

    await pool.query(
      'UPDATE portfolio_users SET last_login_at = NOW() WHERE id = $1',
      [userId]
    );

    await regenerateSession(req);

    req.session.userId = String(userId);
    req.session.mfaVerified = true;

    await saveSession(req);

    return res.json({
      authenticated: true,
      message: 'Verification successful.'
    });
  } catch (error) {
    console.error('MFA verification error:', error.message);

    return res.status(500).json({
      error: 'Unable to verify the code right now.'
    });
  }
});

/*
 * Resend MFA code.
 */
app.post('/api/auth/resend-code', resendLimiter, async (req, res) => {
  try {
    const userId = req.session.pendingUserId;

    if (!userId) {
      return res.status(401).json({
        error: 'Your sign-in session expired. Please sign in again.'
      });
    }

    const userResult = await pool.query(
      'SELECT email FROM portfolio_users WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(401).json({
        error: 'Please sign in again.'
      });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');

    await pool.query(
      `INSERT INTO mfa_challenges
        (user_id, code_hash, expires_at, attempts, created_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes', 0, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         created_at = NOW()`,
      [userId, hashCode(code)]
    );

    try {
      await sendMfaEmail(user.email, code);
    } catch (emailError) {
      await pool.query(
        'DELETE FROM mfa_challenges WHERE user_id = $1',
        [userId]
      );

      throw emailError;
    }

    return res.json({
      message: 'A new verification code has been sent.'
    });
  } catch (error) {
    console.error('Resend code error:', error.message);

    return res.status(503).json({
      error: 'Could not resend the code. Please try again shortly.'
    });
  }
});

/*
 * Return the current authenticated user.
 */
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT email FROM portfolio_users WHERE id = $1',
      [req.session.userId]
    );

    if (!result.rows[0]) {
      return res.status(401).json({
        error: 'Please sign in again.'
      });
    }

    return res.json({
      authenticated: true,
      email: result.rows[0].email
    });
  } catch (error) {
    console.error('Current-user error:', error.message);

    return res.status(500).json({
      error: 'Unable to check your sign-in status.'
    });
  }
});

/*
 * Logout.
 */
app.post('/api/auth/logout', async (req, res) => {
  try {
    const pendingUserId = req.session?.pendingUserId;

    if (pendingUserId) {
      await pool.query(
        'DELETE FROM mfa_challenges WHERE user_id = $1',
        [pendingUserId]
      );
    }

    req.session.destroy((error) => {
      if (error) {
        console.error('Session destruction error:', error.message);

        return res.status(500).json({
          error: 'Unable to sign out cleanly.'
        });
      }

      res.clearCookie('portfolio.sid', {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax'
      });

      return res.json({ message: 'Signed out.' });
    });
  } catch (error) {
    console.error('Logout error:', error.message);

    return res.status(500).json({
      error: 'Unable to sign out cleanly.'
    });
  }
});

/*
 * API fallback.
 * The frontend is deployed separately on GitHub Pages.
 */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled server error:', error.message);

  if (res.headersSent) return;

  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(port, () => {
      console.log(`Portfolio authentication API listening on port ${port}`);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
}

startServer();

async function shutdown() {
  console.log('Shutting down server...');

  await new Promise((resolve) => {
    app.close?.(resolve);
    resolve();
  }).catch(() => {});

  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => {
  pool.end().finally(() => process.exit(0));
});
