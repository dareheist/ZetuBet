// ============================================================
// 1. IMPORTS
// ============================================================
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

// ============================================================
// 2. SERVER AND ENVIRONMENT CONFIGURATION
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const production = process.env.NODE_ENV === 'production';
const FRONTEND_URL = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');

if (!DATABASE_URL) console.warn('WARNING: DATABASE_URL is not configured; account routes will be unavailable.');
if (!JWT_SECRET || JWT_SECRET.length < 32) console.warn('WARNING: Set JWT_SECRET to a random secret of at least 32 characters.');
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;

// ============================================================
// 3. SECURITY, CORS, MIDDLEWARE AND FILE UPLOADS
// ============================================================
app.disable('x-powered-by');
// Railway terminates HTTPS at its proxy; trust the single platform proxy for rate limiting.
app.set('trust proxy', 1);

// ============================================================
// 0. FRONTEND CONNECTION (separate Railway frontend service)
// Set PUBLIC_APP_URL to https://zetucash-production-bd43.up.railway.app
// ============================================================
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && FRONTEND_URL && origin === FRONTEND_URL) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    if (origin && FRONTEND_URL && origin !== FRONTEND_URL) return res.status(403).end();
    return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: '20kb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
const kycUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 3, fields: 12 }, fileFilter: (_req, file, cb) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(new Error('Upload ID photos and selfie as JPEG, PNG, or WebP images only.'));
  cb(null, true);
} });
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait 15 minutes and try again.' } });
const kycLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many document submissions. Please wait before trying again.' } });
// ============================================================
// 4. SHARED HELPERS: DATABASE, PHONE, TOKENS AND AUTHENTICATION
// ============================================================
function dbRequired(_req, res, next) {
  if (!pool) return res.status(503).json({ error: 'Database is not configured. Add DATABASE_URL in your hosting environment.' });
  if (!JWT_SECRET || JWT_SECRET.length < 32) return res.status(503).json({ error: 'Authentication is not configured. Add a strong JWT_SECRET in your hosting environment.' });
  next();
}
function normalizePhone(value) {
  let phone = String(value || '').replace(/[\s()+-]/g, '');
  if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  if (phone.startsWith('7') || phone.startsWith('1')) phone = '254' + phone;
  return /^254[71]\d{8}$/.test(phone) ? phone : null;
}
function issueToken(userId) {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: '7d', issuer: 'zetucash' });
}
function setAuthCookie(res, token) {
  res.cookie('zetucash_session', token, { httpOnly: true, secure: production, sameSite: production ? 'none' : 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
}
async function authRequired(req, res, next) {
  try {
    const token = req.cookies.zetucash_session;
    if (!token) return res.status(401).json({ error: 'Please log in to continue.' });
    const payload = jwt.verify(token, JWT_SECRET, { issuer: 'zetucash' });
    const result = await pool.query('SELECT id, full_name, email, phone_e164, savings_balance, loan_wallet_balance, outstanding_debt, created_at FROM users WHERE id = $1', [payload.sub]);
    if (!result.rowCount) return res.status(401).json({ error: 'Account not found. Please create an account.' });
    req.user = result.rows[0];
    next();
  } catch (_error) {
    res.clearCookie('zetucash_session', { path: '/', httpOnly: true, secure: production, sameSite: production ? 'none' : 'lax' });
    return res.status(401).json({ error: 'Your session expired. Please log in again.' });
  }
}
// ============================================================
// 5. DATABASE TABLES AND INITIALIZATION
// ============================================================
async function initializeDatabase() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone_e164 VARCHAR(12) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    savings_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (savings_balance >= 0),
    loan_wallet_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (loan_wallet_balance >= 0),
    outstanding_debt NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (outstanding_debt >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id VARCHAR(20)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email)) WHERE email IS NOT NULL');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_national_id_unique_idx ON users (national_id) WHERE national_id IS NOT NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_audit (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    event VARCHAR(30) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS loan_applications (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    date_of_birth DATE NOT NULL, county VARCHAR(60) NOT NULL, town VARCHAR(100) NOT NULL,
    physical_address VARCHAR(180) NOT NULL, employment_status VARCHAR(40) NOT NULL,
    monthly_income NUMERIC(14,2) NOT NULL CHECK (monthly_income >= 0), loan_purpose VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
    review_note TEXT, submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS kyc_documents (
    application_id BIGINT PRIMARY KEY REFERENCES loan_applications(id) ON DELETE CASCADE,
    id_front BYTEA NOT NULL, id_front_type VARCHAR(40) NOT NULL,
    id_back BYTEA NOT NULL, id_back_type VARCHAR(40) NOT NULL,
    selfie BYTEA NOT NULL, selfie_type VARCHAR(40) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS loan_requests (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    principal NUMERIC(14,2) NOT NULL CHECK (principal > 0), charge NUMERIC(14,2) NOT NULL,
    total_repayment NUMERIC(14,2) NOT NULL, repayment_days INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','disbursed','repaid')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reference VARCHAR(120) NOT NULL UNIQUE, provider_id VARCHAR(160) UNIQUE,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('deposit','withdrawal')),
    wallet VARCHAR(30) NOT NULL DEFAULT 'savings', amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    status VARCHAR(24) NOT NULL DEFAULT 'pending', refunded BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  console.log('Neon database tables are ready.');
}

// ============================================================
// 6. HEALTH CHECK
// ============================================================
app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'ZetuCash', databaseConfigured: !!pool, mode: process.env.ZETUPAY_SECRET_KEY ? 'payments-configured' : 'account-foundation' }));

// ============================================================
// 7. ZETUPAY API CONFIGURATION
// Keep the secret key on the server only.
// ============================================================
const ZETUPAY_BASE = 'https://pay.zetupay.co.ke/api/v1';
async function zetupayRequest(endpoint, { method = 'GET', body, idempotencyKey } = {}) {
  const key = process.env.ZETUPAY_SECRET_KEY;
  if (!key) throw new Error('Payments are not configured. Add ZETUPAY_SECRET_KEY in Railway Variables.');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${ZETUPAY_BASE}${endpoint}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `ZetuPay request failed (${response.status}).`);
  return data;
}

// ============================================================
// 8. DEPOSIT PAYMENT INITIATION — DIRECT M-PESA STK PUSH
// No checkout redirect. ZetuPay prompts the user's registered phone.
// ============================================================
app.post('/api/payments/deposit', dbRequired, authRequired, async (req, res) => {
  const amount = Number(req.body && req.body.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 250000) {
    return res.status(400).json({ error: 'Enter a whole-KSh deposit amount from KSh 1 to KSh 250,000.' });
  }
  const reference = `ZC-D-${req.user.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await pool.query("INSERT INTO payment_transactions (user_id,reference,kind,wallet,amount,status) VALUES ($1,$2,'deposit','savings',$3,'pending')", [req.user.id, reference, amount]);
    const result = await zetupayRequest('/payment/stk-push', {
      method: 'POST',
      idempotencyKey: reference,
      body: { amount, phoneNumber: req.user.phone_e164, reference, identifier: String(req.user.id), currency: 'KES' }
    });
    const data = result.data || result;
    const paymentKey = data.paymentKey || data.payment_key;
    const providerId = paymentKey || data.waveTransactionId || data.transactionId || null;
    if (!result.success || !paymentKey) throw new Error(result.message || 'ZetuPay did not confirm that the STK Push request was created.');
    await pool.query("UPDATE payment_transactions SET provider_id=$1,status=$2,updated_at=NOW() WHERE reference=$3", [providerId, String(data.status || 'processing').toLowerCase(), reference]);
    return res.status(202).json({ message: 'STK Push sent. Check your phone and enter your M-Pesa PIN.', reference, paymentKey, status: data.status || 'processing' });
  } catch (error) {
    await pool.query("UPDATE payment_transactions SET status='failed',updated_at=NOW() WHERE reference=$1 AND status='pending'", [reference]).catch(() => {});
    console.error('ZetuPay STK Push initiation failed:', error.message);
    return res.status(502).json({ error: error.message || 'Could not send the M-Pesa prompt. No balance was changed.' });
  }
});

// ============================================================
// 8A. DEPOSIT STATUS — VERIFY WITH ZETUPAY WITHOUT A REDIRECT
// Used by the frontend while the user approves or cancels the prompt.
// ============================================================
app.get('/api/payments/deposit/:reference/status', dbRequired, authRequired, async (req, res) => {
  const reference = String(req.params.reference || '');
  const found = await pool.query("SELECT id,reference,provider_id,amount,status FROM payment_transactions WHERE reference=$1 AND user_id=$2 AND kind='deposit'", [reference, req.user.id]);
  if (!found.rowCount) return res.status(404).json({ error: 'Deposit request not found.' });
  const tx = found.rows[0];
  if (tx.status === 'success') return res.json({ reference, status: 'success', amount: Number(tx.amount) });
  if (!tx.provider_id) return res.json({ reference, status: tx.status });
  try {
    const result = await zetupayRequest(`/payment/stk-push/${encodeURIComponent(tx.provider_id)}`);
    const data = result.data || result;
    const status = String(data.status || tx.status).toLowerCase();
    if (status === 'success') {
      if (Number(data.amount) !== Number(tx.amount) || String(data.reference || reference) !== reference) {
        return res.status(409).json({ error: 'The provider payment details did not match this deposit. Please contact support.' });
      }
      await finalizeDepositSuccess(reference, data);
      return res.json({ reference, status: 'success', amount: Number(tx.amount), receiptNumber: data.receiptNumber || null });
    }
    if (['failed', 'cancelled', 'expired'].includes(status)) {
      await pool.query("UPDATE payment_transactions SET status=$1,updated_at=NOW() WHERE reference=$2 AND status<>'success'", [status, reference]);
    }
    return res.json({ reference, status });
  } catch (error) {
    console.error('ZetuPay deposit status check failed:', error.message);
    return res.status(502).json({ error: 'Could not check the payment yet. Your balance has not been changed.' });
  }
});

// ============================================================
// 9. WITHDRAWAL AND PAYOUT INITIATION
// ============================================================
app.post('/api/payments/withdraw', dbRequired, authRequired, async (req, res) => {
  const amount = Number(req.body && req.body.amount);
  const wallet = req.body && req.body.wallet === 'loan' ? 'loan' : 'savings';
  if (!Number.isInteger(amount) || amount < 10 || amount > 1000) return res.status(400).json({ error: 'Enter a whole-KSh withdrawal between KSh 10 and KSh 1,000.' });
  const balanceColumn = wallet === 'loan' ? 'loan_wallet_balance' : 'savings_balance';
  const reference = `ZC-W-${req.user.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`SELECT ${balanceColumn} AS balance FROM users WHERE id=$1 FOR UPDATE`, [req.user.id]);
    if (!locked.rowCount || Number(locked.rows[0].balance) < amount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Insufficient wallet balance.' }); }
    await client.query(`UPDATE users SET ${balanceColumn}=${balanceColumn}-$1 WHERE id=$2`, [amount, req.user.id]);
    await client.query("INSERT INTO payment_transactions (user_id,reference,kind,wallet,amount,status) VALUES ($1,$2,'withdrawal',$3,$4,'processing')", [req.user.id, reference, wallet, amount]);
    await client.query('COMMIT');
    const result = await zetupayPost('/payout/b2c', { amount, phoneNumber: req.user.phone_e164, identifier: reference });
    const data = result.data || result;
    const providerId = data.waveTransactionId || data.transactionId || data.id || null;
    await pool.query("UPDATE payment_transactions SET provider_id=COALESCE($1,provider_id),status=$2,updated_at=NOW() WHERE reference=$3", [providerId, String(data.status || 'processing').toLowerCase(), reference]);
    res.json({ message: 'Withdrawal request submitted. It may remain pending while ZetuPay processes it.', reference, status: data.status || 'processing' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // If the payout request failed after the balance was reserved, refund once.
    const tx = await pool.query("SELECT user_id,wallet,amount,status,refunded FROM payment_transactions WHERE reference=$1", [reference]).catch(() => ({ rows: [] }));
    if (tx.rows[0] && !tx.rows[0].refunded) {
      const col = tx.rows[0].wallet === 'loan' ? 'loan_wallet_balance' : 'savings_balance';
      const c = await pool.connect();
      try { await c.query('BEGIN'); const lock = await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[tx.rows[0].user_id]); if (lock.rowCount) await c.query(`UPDATE users SET ${col}=${col}+$1 WHERE id=$2`,[tx.rows[0].amount,tx.rows[0].user_id]); await c.query("UPDATE payment_transactions SET status='failed',refunded=TRUE,updated_at=NOW() WHERE reference=$1 AND refunded=FALSE",[reference]); await c.query('COMMIT'); } catch (_) { await c.query('ROLLBACK').catch(()=>{}); } finally { c.release(); }
    }
    console.error('ZetuPay withdrawal failed:', error.message);
    res.status(502).json({ error: error.message || 'Could not submit withdrawal. If the request reached ZetuPay, contact support before retrying.' });
  } finally { client.release(); }
});
// ============================================================
// 10. ZETUPAY WEBHOOK SIGNATURE VERIFICATION AND DEPOSIT CREDITING
// ZetuPay signs the exact raw request body using the live Secret Key.
// ============================================================
function verifyZetuPaySignature(req) {
  const key = process.env.ZETUPAY_SECRET_KEY || '';
  const header = String(req.get('x-zetupay-signature') || '');
  if (!key || !Buffer.isBuffer(req.rawBody) || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) >= 300 || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', key).update(`${parts.t}.${req.rawBody.toString('utf8')}`).digest('hex');
  const actualBuffer = Buffer.from(String(parts.v1));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function finalizeDepositSuccess(reference, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query("SELECT * FROM payment_transactions WHERE reference=$1 AND kind='deposit' FOR UPDATE", [reference]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return false; }
    const tx = found.rows[0];
    if (Number(data.amount) !== Number(tx.amount) || String(data.reference || reference) !== reference) {
      await client.query('ROLLBACK');
      throw new Error('Payment amount or reference does not match the deposit.');
    }
    if (tx.status !== 'success') {
      await client.query('UPDATE users SET savings_balance=savings_balance+$1 WHERE id=$2', [tx.amount, tx.user_id]);
      await client.query("UPDATE payment_transactions SET status='success',provider_id=COALESCE($1,provider_id),updated_at=NOW() WHERE id=$2", [data.waveTransactionId || data.paymentKey || null, tx.id]);
    } else if (data.waveTransactionId) {
      await client.query('UPDATE payment_transactions SET provider_id=COALESCE($1,provider_id),updated_at=NOW() WHERE id=$2', [data.waveTransactionId, tx.id]);
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function processZetuPayWebhook(req, res, expectedKind) {
  if (!verifyZetuPaySignature(req)) return res.status(401).json({ error: 'Invalid ZetuPay webhook signature.' });
  if (!pool) return res.status(503).json({ error: 'Database is not configured.' });
  let payload;
  try { payload = JSON.parse(req.rawBody.toString('utf8')); }
  catch (_) { return res.status(400).json({ error: 'Invalid webhook JSON.' }); }

  // ZetuPay payment callbacks are top-level transactions; payout callbacks
  // use top-level status, payoutID and identifier fields.
  if (expectedKind === 'deposit') {
    const reference = String(payload.reference || '');
    if (!reference) return res.status(400).json({ error: 'Missing transaction reference.' });
    if (String(payload.status || '').toLowerCase() !== 'success') return res.status(200).json({ received: true, ignored: true });
    try {
      await finalizeDepositSuccess(reference, payload);
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('ZetuPay deposit webhook error:', error.message);
      return res.status(400).json({ error: 'Payment verification failed.' });
    }
  }

  const reference = String(payload.identifier || '');
  if (!reference) return res.status(400).json({ error: 'Missing payout identifier.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query("SELECT * FROM payment_transactions WHERE reference=$1 AND kind='withdrawal' FOR UPDATE", [reference]);
    if (!found.rowCount) { await client.query('ROLLBACK'); return res.status(200).json({ received: true, ignored: true }); }
    const tx = found.rows[0];
    const status = String(payload.status || '').toLowerCase();
    if (['failed', 'failure', 'rejected', 'cancelled'].includes(status) && !tx.refunded && tx.status !== 'success') {
      const col = tx.wallet === 'loan' ? 'loan_wallet_balance' : 'savings_balance';
      await client.query(`UPDATE users SET ${col}=${col}+$1 WHERE id=$2`, [tx.amount, tx.user_id]);
      await client.query("UPDATE payment_transactions SET status='failed',refunded=TRUE,provider_id=COALESCE($1,provider_id),updated_at=NOW() WHERE id=$2", [payload.payoutID || null, tx.id]);
    } else if (['completed', 'success', 'successful'].includes(status) && tx.status !== 'success') {
      await client.query("UPDATE payment_transactions SET status='success',provider_id=COALESCE($1,provider_id),updated_at=NOW() WHERE id=$2", [payload.payoutID || null, tx.id]);
    }
    await client.query('COMMIT');
    return res.status(200).json({ received: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ZetuPay payout webhook error:', error.message);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  } finally { client.release(); }
}
app.post('/webhooks/zetupay', (req, res) => processZetuPayWebhook(req, res, 'deposit'));

// ============================================================
// 11. ZETUPAY PAYOUT WEBHOOK — WITHDRAWAL RESULT
// URL: POST /webhooks/zetupay/payout
// ============================================================
app.post('/webhooks/zetupay/payout', (req, res) => processZetuPayWebhook(req, res, 'withdrawal'));

// ============================================================
// 12. USER REGISTRATION
// ============================================================
app.post('/api/auth/register', authLimiter, dbRequired, async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
    const email = String(req.body.email || '').trim().toLowerCase();
    const nationalId = String(req.body.nationalId || '').trim().replace(/\s+/g, '');
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    if (fullName.length < 3 || fullName.length > 100 || fullName.split(' ').length < 2) return res.status(400).json({ error: 'Enter your real full name as shown on your ID.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!/^\d{5,12}$/.test(nationalId)) return res.status(400).json({ error: 'Enter a valid Kenyan ID number using digits only.' });
    if (!phone) return res.status(400).json({ error: 'Enter a valid M-Pesa phone number, e.g. 0712345678 or 254712345678.' });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be 8–72 characters long.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query('INSERT INTO users (full_name, email, national_id, phone_e164, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, phone_e164, savings_balance, loan_wallet_balance, outstanding_debt, created_at', [fullName, email, nationalId, phone, passwordHash]);
    const user = result.rows[0];
    await pool.query("INSERT INTO auth_audit (user_id, event) VALUES ($1, 'register')", [user.id]);
    setAuthCookie(res, issueToken(user.id));
    res.status(201).json({ user: safeUser(user), message: 'Account created successfully.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That email, ID number, or M-Pesa number is already registered. Please log in or contact support.' });
    console.error('Registration failed:', error.message);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

// ============================================================
// 13. USER LOGIN
// ============================================================
app.post('/api/auth/login', authLimiter, dbRequired, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) return res.status(400).json({ error: 'Enter your registered email address and password.' });
    const result = await pool.query('SELECT id, full_name, email, phone_e164, password_hash, savings_balance, loan_wallet_balance, outstanding_debt, created_at FROM users WHERE LOWER(email) = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Incorrect email address or password.' });
    await pool.query("INSERT INTO auth_audit (user_id, event) VALUES ($1, 'login')", [user.id]);
    setAuthCookie(res, issueToken(user.id));
    res.json({ user: safeUser(user), message: 'Welcome back.' });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Could not log in right now. Please try again.' });
  }
});

// ============================================================
// 14. USER LOGOUT, ACCOUNT DETAILS AND SAFE USER RESPONSE
// ============================================================
app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('zetucash_session', { httpOnly: true, secure: production, sameSite: production ? 'none' : 'lax', path: '/' });
  res.json({ message: 'You have been logged out.' });
});
app.get('/api/auth/me', dbRequired, authRequired, (req, res) => res.json({ user: safeUser(req.user) }));
function safeUser(user) {
  return { id: user.id, fullName: user.full_name, email: user.email || '', phone: user.phone_e164, savingsBalance: Number(user.savings_balance || 0), loanWalletBalance: Number(user.loan_wallet_balance || 0), outstandingDebt: Number(user.outstanding_debt || 0), loanLimit: Math.floor(Number(user.savings_balance || 0) * 1.5), createdAt: user.created_at };
}

// ============================================================
// 15. ADMIN ACCESS, KYC REVIEW AND LOAN REQUEST APPROVAL/REJECTION
// ============================================================
// ADMIN DASHBOARD DATA: users, balances, transactions and all loan applications.
app.get('/api/admin/dashboard', dbRequired, adminReviewRequired, async (_req, res) => {
  try {
    const [users, tx, applications, loans, totals] = await Promise.all([
      pool.query(`SELECT id,full_name,email,phone_e164,savings_balance,loan_wallet_balance,outstanding_debt,created_at FROM users ORDER BY created_at DESC LIMIT 1000`),
      pool.query(`SELECT t.id,t.user_id,u.full_name,u.email,u.phone_e164,t.reference,t.kind,t.wallet,t.amount,t.status,t.created_at,t.updated_at FROM payment_transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 1000`),
      pool.query(`SELECT a.id,a.user_id,u.full_name,u.email,u.phone_e164,a.date_of_birth,a.county,a.town,a.physical_address,a.employment_status,a.monthly_income,a.loan_purpose,a.status,a.review_note,a.submitted_at,a.reviewed_at FROM loan_applications a JOIN users u ON u.id=a.user_id ORDER BY a.submitted_at DESC LIMIT 500`),
      pool.query(`SELECT r.id,r.user_id,u.full_name,u.email,u.phone_e164,r.principal,r.charge,r.total_repayment,r.repayment_days,r.status,r.created_at FROM loan_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT 1000`),
      pool.query(`SELECT COUNT(*)::int AS users, COALESCE(SUM(savings_balance),0) AS savings, COALESCE(SUM(loan_wallet_balance),0) AS loan_wallets, COALESCE(SUM(outstanding_debt),0) AS debt FROM users`)
    ]);
    res.json({users:users.rows.map(r=>({...r,savingsBalance:Number(r.savings_balance),loanWalletBalance:Number(r.loan_wallet_balance),outstandingDebt:Number(r.outstanding_debt),loanLimit:Math.floor(Number(r.savings_balance)*1.5)})),transactions:tx.rows.map(r=>({...r,amount:Number(r.amount)})),applications:applications.rows,loans:loans.rows.map(r=>({...r,principal:Number(r.principal),charge:Number(r.charge),totalRepayment:Number(r.total_repayment),repaymentDays:Number(r.repayment_days)})),stats:{userCount:totals.rows[0].users,savingsTotal:Number(totals.rows[0].savings),loanWalletTotal:Number(totals.rows[0].loan_wallets),outstandingDebtTotal:Number(totals.rows[0].debt)}});
  } catch (error) { console.error('Admin dashboard data error:',error.message); res.status(500).json({error:'Could not load dashboard data.'}); }
});

// ADMIN REVIEW: protect these endpoints with a separate secret; never expose it in browser code.
function adminReviewRequired(req, res, next) {
  const configured = process.env.ADMIN_REVIEW_TOKEN || '';
  const supplied = String(req.get('x-admin-review-token') || '');
  if (configured.length < 32 || supplied.length !== configured.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) {
    return res.status(401).json({ error: 'Authorised reviewer access required.' });
  }
  next();
}
app.get('/api/admin/loan-applications/pending', dbRequired, adminReviewRequired, async (_req, res) => {
  try {
    const result = await pool.query(`SELECT a.id,a.user_id,u.full_name,u.email,u.phone_e164,a.date_of_birth,a.county,a.town,a.physical_address,a.employment_status,a.monthly_income,a.loan_purpose,a.status,a.submitted_at,d.id_front,d.id_front_type,d.id_back,d.id_back_type,d.selfie,d.selfie_type
      FROM loan_applications a JOIN users u ON u.id=a.user_id JOIN kyc_documents d ON d.application_id=a.id WHERE a.status='pending' ORDER BY a.submitted_at ASC LIMIT 10`);
    res.json({ applications: result.rows.map(row => ({ id: row.id, userId: row.user_id, fullName: row.full_name, email: row.email, phone: row.phone_e164, dateOfBirth: row.date_of_birth, county: row.county, town: row.town, physicalAddress: row.physical_address, employmentStatus: row.employment_status, monthlyIncome: Number(row.monthly_income), loanPurpose: row.loan_purpose, submittedAt: row.submitted_at, documents: { idFront: `data:${row.id_front_type};base64,${Buffer.from(row.id_front).toString('base64')}`, idBack: `data:${row.id_back_type};base64,${Buffer.from(row.id_back).toString('base64')}`, selfie: `data:${row.selfie_type};base64,${Buffer.from(row.selfie).toString('base64')}` } })) });
  } catch (error) { console.error('Admin KYC list error:', error.message); res.status(500).json({ error: 'Could not load applications.' }); }
});
app.post('/api/admin/loan-applications/:id/review', dbRequired, adminReviewRequired, async (req, res) => {
  const status = String(req.body.status || '');
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (!['verified','rejected'].includes(status)) return res.status(400).json({ error: 'Review status must be verified or rejected.' });
  try {
    const result = await pool.query("UPDATE loan_applications SET status=$1,review_note=$2,reviewed_at=NOW() WHERE id=$3 AND status='pending' RETURNING id,status,reviewed_at", [status,note || null,req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Pending application not found.' });
    res.json({ application: result.rows[0], message: status === 'verified' ? 'Identity verification approved.' : 'Identity verification rejected. The customer may correct details and resubmit.' });
  } catch (error) { console.error('Admin KYC review error:', error.message); res.status(500).json({ error: 'Could not update review status.' }); }
});

// ADMIN LOAN REQUEST QUEUE: submitted loan requests awaiting an admin decision.
// GET /api/admin/loan-requests?status=pending
app.get('/api/admin/loan-requests', dbRequired, adminReviewRequired, async (req, res) => {
  const requestedStatus = String(req.query.status || 'pending').toLowerCase();
  const allowedStatuses = ['pending', 'approved', 'rejected', 'disbursed', 'repaid', 'all'];
  if (!allowedStatuses.includes(requestedStatus)) return res.status(400).json({ error: 'Invalid loan request status.' });
  try {
    const params = [];
    let statusFilter = '';
    if (requestedStatus !== 'all') { params.push(requestedStatus); statusFilter = `WHERE r.status = $${params.length}`; }
    const result = await pool.query(`SELECT r.id, r.user_id, u.full_name, u.email, u.phone_e164, r.principal, r.charge, r.total_repayment, r.repayment_days, r.status, r.created_at
      FROM loan_requests r JOIN users u ON u.id = r.user_id ${statusFilter}
      ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at ASC LIMIT 200`, params);
    res.json({ requests: result.rows.map(row => ({
      id: row.id, userId: row.user_id, fullName: row.full_name, email: row.email || '', phone: row.phone_e164,
      principal: Number(row.principal), charge: Number(row.charge), totalRepayment: Number(row.total_repayment),
      repaymentDays: Number(row.repayment_days), status: row.status, submittedAt: row.created_at
    })) });
  } catch (error) { console.error('Admin loan request list error:', error.message); res.status(500).json({ error: 'Could not load loan requests.' }); }
});

// ADMIN LOAN DECISION: approves or rejects a pending request; approval does not disburse funds.
// POST /api/admin/loan-requests/:id/review with {"status":"approved"} or {"status":"rejected","note":"..."}
app.post('/api/admin/loan-requests/:id/review', dbRequired, adminReviewRequired, async (req, res) => {
  const requestId = String(req.params.id || '');
  const status = String((req.body && req.body.status) || '').toLowerCase();
  const note = String((req.body && req.body.note) || '').trim().slice(0, 500);
  if (!/^\d+$/.test(requestId)) return res.status(400).json({ error: 'Invalid loan request ID.' });
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status must be approved or rejected.' });
  try {
    const result = await pool.query("UPDATE loan_requests SET status = $1 WHERE id = $2 AND status = 'pending' RETURNING id, user_id, principal, charge, total_repayment, repayment_days, status, created_at", [status, requestId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Pending loan request not found; it may already have been reviewed.' });
    res.json({ request: { ...result.rows[0], principal: Number(result.rows[0].principal), charge: Number(result.rows[0].charge), totalRepayment: Number(result.rows[0].total_repayment), repaymentDays: Number(result.rows[0].repayment_days), adminNote: note || null }, message: status === 'approved' ? 'Loan request approved. Funds have not been disbursed.' : 'Loan request rejected.' });
  } catch (error) { console.error('Admin loan request review error:', error.message); res.status(500).json({ error: 'Could not review loan request.' }); }
});

// ============================================================
// 16. LOAN APPLICATION AND KYC DOCUMENTS
// ============================================================
app.get('/api/loan/application-status', dbRequired, authRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT status, review_note, submitted_at, reviewed_at FROM loan_applications WHERE user_id = $1', [req.user.id]);
    if (!result.rowCount) return res.json({ status: 'not_submitted' });
    const row = result.rows[0];
    res.json({ status: row.status, reviewNote: row.status === 'rejected' ? row.review_note : undefined, submittedAt: row.submitted_at, reviewedAt: row.reviewed_at });
  } catch (error) {
    console.error('KYC status error:', error.message);
    res.status(500).json({ error: 'Could not load verification status.' });
  }
});

app.post('/api/loan/application', kycLimiter, dbRequired, authRequired, (req, res, next) => {
  kycUpload.fields([{ name: 'idFront', maxCount: 1 }, { name: 'idBack', maxCount: 1 }, { name: 'selfie', maxCount: 1 }])(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 3 MB or smaller.' : error.message || 'Could not upload the images.' });
    next();
  });
}, async (req, res) => {
  const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
  const nationalId = String(req.body.nationalId || '').trim();
  const dateOfBirth = String(req.body.dateOfBirth || '').trim();
  const county = String(req.body.county || '').trim();
  const town = String(req.body.town || '').trim();
  const physicalAddress = String(req.body.physicalAddress || '').trim();
  const employmentStatus = String(req.body.employmentStatus || '').trim();
  const monthlyIncome = Number(req.body.monthlyIncome);
  const loanPurpose = String(req.body.loanPurpose || '').trim();
  const files = req.files || {};
  const front = files.idFront && files.idFront[0];
  const back = files.idBack && files.idBack[0];
  const selfie = files.selfie && files.selfie[0];
  if (fullName.toLowerCase() !== String(req.user.full_name || '').trim().toLowerCase()) return res.status(400).json({ error: 'Your full name must match the name used when you registered.' });
  if (!/^\d{5,12}$/.test(nationalId)) return res.status(400).json({ error: 'Enter a valid national ID number.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth)) || new Date(dateOfBirth) >= new Date()) return res.status(400).json({ error: 'Enter a valid date of birth.' });
  if (!county || county.length > 60 || !town || town.length > 100 || !physicalAddress || physicalAddress.length > 180) return res.status(400).json({ error: 'Complete your county, town/estate, and physical address.' });
  if (!['Employed','Self-employed','Casual worker','Student','Unemployed','Other'].includes(employmentStatus)) return res.status(400).json({ error: 'Choose your employment status.' });
  if (!Number.isFinite(monthlyIncome) || monthlyIncome < 0 || monthlyIncome > 100000000) return res.status(400).json({ error: 'Enter a valid monthly income.' });
  if (!['Business','School fees','Medical expenses','Household needs','Emergency','Other'].includes(loanPurpose)) return res.status(400).json({ error: 'Choose a loan purpose.' });
  if (!front || !back || !selfie) return res.status(400).json({ error: 'Upload the front and back of your ID and a selfie.' });
  const validImage = (file) => {
    const b = file.buffer;
    if (file.mimetype === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    if (file.mimetype === 'image/png') return b.length > 8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (file.mimetype === 'image/webp') return b.length > 12 && b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP';
    return false;
  };
  if (![front, back, selfie].every(validImage)) return res.status(400).json({ error: 'One or more files are not valid image files. Please choose JPEG, PNG or WebP photos.' });
  try {
    const account = await pool.query('SELECT national_id FROM users WHERE id = $1', [req.user.id]);
    if (!account.rowCount || account.rows[0].national_id !== nationalId) return res.status(400).json({ error: 'The ID number must match the number on your registered account.' });
    const existing = await pool.query('SELECT status FROM loan_applications WHERE user_id = $1', [req.user.id]);
    if (existing.rowCount && existing.rows[0].status !== 'rejected') return res.status(409).json({ error: 'Your verification application has already been submitted. Current status: ' + existing.rows[0].status + '.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const appResult = await client.query(`INSERT INTO loan_applications (user_id,date_of_birth,county,town,physical_address,employment_status,monthly_income,loan_purpose,status,review_note,submitted_at,reviewed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',NULL,NOW(),NULL)
        ON CONFLICT (user_id) DO UPDATE SET date_of_birth=EXCLUDED.date_of_birth,county=EXCLUDED.county,town=EXCLUDED.town,physical_address=EXCLUDED.physical_address,employment_status=EXCLUDED.employment_status,monthly_income=EXCLUDED.monthly_income,loan_purpose=EXCLUDED.loan_purpose,status='pending',review_note=NULL,submitted_at=NOW(),reviewed_at=NULL RETURNING id`,
        [req.user.id,dateOfBirth,county,town,physicalAddress,employmentStatus,monthlyIncome,loanPurpose]);
      await client.query(`INSERT INTO kyc_documents (application_id,id_front,id_front_type,id_back,id_back_type,selfie,selfie_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (application_id) DO UPDATE SET id_front=EXCLUDED.id_front,id_front_type=EXCLUDED.id_front_type,id_back=EXCLUDED.id_back,id_back_type=EXCLUDED.id_back_type,selfie=EXCLUDED.selfie,selfie_type=EXCLUDED.selfie_type,created_at=NOW()`,
        [appResult.rows[0].id,front.buffer,front.mimetype,back.buffer,back.mimetype,selfie.buffer,selfie.mimetype]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    res.status(201).json({ status: 'pending', message: 'Your documents were submitted. Verification is pending manual review; loan access will remain locked until an authorised reviewer approves your application.' });
  } catch (error) {
    console.error('KYC submission error:', error.message);
    res.status(500).json({ error: 'Could not submit your application. Please try again later.' });
  }
});

// ============================================================
// 17. LOAN QUOTE CALCULATION
// ============================================================
app.post('/api/loan/quote', dbRequired, authRequired, async (req, res) => {
  const verification = await pool.query('SELECT status FROM loan_applications WHERE user_id = $1', [req.user.id]);
  if (!verification.rowCount || verification.rows[0].status !== 'verified') return res.status(403).json({ error: 'Complete and pass identity verification before requesting a loan.' });
  const principal = Number(req.body && req.body.principal);
  const savings = Number(req.user.savings_balance || 0);
  const limit = Math.floor(savings * 1.5);
  if (!Number.isFinite(principal) || principal <= 0 || !Number.isInteger(principal)) return res.status(400).json({ error: 'Enter a valid whole-KSh loan amount.' });
  if (Number(req.user.outstanding_debt) > 0) return res.status(409).json({ error: 'Repay your existing loan before applying again.' });
  if (principal > limit) return res.status(400).json({ error: `Your current indicative loan limit is KSh ${limit}.`, limit });
  const charge = Math.round(principal * (20 / 150));
  const days = principal <= 500 ? 14 : principal <= 1500 ? 21 : principal <= 5000 ? 30 : principal <= 10000 ? 45 : 60;
  res.json({ limit, principal, charge, total: principal + charge, days, approved: false, message: 'Indicative quote only. No loan is approved and no money is moved.' });
});

// ============================================================
// 18. LOAN REQUEST SUBMISSION
// ============================================================
app.post('/api/loan/request', dbRequired, authRequired, async (req, res) => {
  const principal = Number(req.body && req.body.principal);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const verify = await client.query('SELECT status FROM loan_applications WHERE user_id = $1 FOR UPDATE', [req.user.id]);
    if (!verify.rowCount || verify.rows[0].status !== 'verified') { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Your identity must be verified before applying for a loan.' }); }
    const user = await client.query('SELECT savings_balance,outstanding_debt FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    const savings = Number(user.rows[0].savings_balance || 0);
    const limit = Math.floor(savings * 1.5);
    if (!Number.isInteger(principal) || principal <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Enter a valid whole-KSh loan amount.' }); }
    if (Number(user.rows[0].outstanding_debt) > 0) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Repay your existing loan before applying again.' }); }
    if (principal > limit) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Your current loan limit is KSh ${limit}.` }); }
    const active = await client.query("SELECT id FROM loan_requests WHERE user_id=$1 AND status IN ('pending','approved','disbursed') LIMIT 1", [req.user.id]);
    if (active.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'You already have a loan request being processed or an active loan.' }); }
    const charge = Math.round(principal * (20 / 150));
    const days = principal <= 500 ? 14 : principal <= 1500 ? 21 : principal <= 5000 ? 30 : principal <= 10000 ? 45 : 60;
    // Application approval authorizes borrowing; this request is the customer's separate decision to take a specific amount.
    // Credit only the chosen principal, never the full indicative limit, and record the debt atomically.
    const result = await client.query("INSERT INTO loan_requests (user_id,principal,charge,total_repayment,repayment_days,status) VALUES ($1,$2,$3,$4,$5,'disbursed') RETURNING id,created_at", [req.user.id,principal,charge,principal+charge,days]);
    await client.query('UPDATE users SET loan_wallet_balance=loan_wallet_balance+$1, outstanding_debt=outstanding_debt+$2 WHERE id=$3', [principal,principal+charge,req.user.id]);
    await client.query('COMMIT');
    res.status(201).json({ status: 'disbursed', requestId: result.rows[0].id, principal, charge, total: principal+charge, days, createdAt: result.rows[0].created_at, message: `KSh ${principal} has been credited to your Loan Wallet. Your approved limit was not transferred; only the amount you selected was disbursed.` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Loan request error:', error.message);
    res.status(500).json({ error: 'Could not submit your loan request.' });
  } finally { client.release(); }
});

// ============================================================
// 19. FALLBACK PAGE AND SERVER STARTUP
// ============================================================
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initializeDatabase().catch(error => { console.error('Database initialization failed:', error.message); }).finally(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`ZetuCash listening on port ${PORT}`));
});
