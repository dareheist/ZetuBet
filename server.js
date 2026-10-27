const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const production = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) console.warn('WARNING: DATABASE_URL is not configured; account routes will be unavailable.');
if (!JWT_SECRET || JWT_SECRET.length < 32) console.warn('WARNING: Set JWT_SECRET to a random secret of at least 32 characters.');
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 }) : null;

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
const kycUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 3, fields: 12 }, fileFilter: (_req, file, cb) => {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(new Error('Upload ID photos and selfie as JPEG, PNG, or WebP images only.'));
  cb(null, true);
} });
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait 15 minutes and try again.' } });
const kycLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many document submissions. Please wait before trying again.' } });
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
  res.cookie('zetucash_session', token, { httpOnly: true, secure: production, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
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
    res.clearCookie('zetucash_session', { path: '/' });
    return res.status(401).json({ error: 'Your session expired. Please log in again.' });
  }
}
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
  await pool.query(`CREATE TABLE IF NOT EXISTS wallet_transactions (
    id BIGSERIAL PRIMARY KEY,
    reference VARCHAR(100) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet VARCHAR(20) NOT NULL CHECK (wallet IN ('savings','loan')) ,
    type VARCHAR(20) NOT NULL CHECK (type IN ('DEPOSIT','WITHDRAWAL')),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
    provider_id VARCHAR(120), provider_receipt VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx ON wallet_transactions (user_id, created_at DESC)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_provider_id_idx ON wallet_transactions (provider_id) WHERE provider_id IS NOT NULL');
  console.log('Neon database tables are ready.');
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', app: 'ZetuCash', databaseConfigured: !!pool, mode: 'account-foundation' }));

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

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('zetucash_session', { httpOnly: true, secure: production, sameSite: 'lax', path: '/' });
  res.json({ message: 'You have been logged out.' });
});
app.get('/api/auth/me', dbRequired, authRequired, (req, res) => res.json({ user: safeUser(req.user) }));
function safeUser(user) {
  return { id: user.id, fullName: user.full_name, email: user.email || '', phone: user.phone_e164, savingsBalance: Number(user.savings_balance || 0), loanWalletBalance: Number(user.loan_wallet_balance || 0), outstandingDebt: Number(user.outstanding_debt || 0), loanLimit: Math.floor(Number(user.savings_balance || 0) * 1.5), createdAt: user.created_at };
}

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

// 5. LOAN APPLICATION SECTION — KYC status and secure document submission
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
    const result = await client.query("INSERT INTO loan_requests (user_id,principal,charge,total_repayment,repayment_days,status) VALUES ($1,$2,$3,$4,$5,'pending') RETURNING id", [req.user.id,principal,charge,principal+charge,days]);
    await client.query('COMMIT');
    res.status(201).json({ status: 'pending', requestId: result.rows[0].id, principal, charge, total: principal+charge, days, message: 'Your loan request has been sent for review. It is not approved and no funds have been disbursed.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Loan request error:', error.message);
    res.status(500).json({ error: 'Could not submit your loan request.' });
  } finally { client.release(); }
});

// ZETUPAY PAYMENTS — all money changes are backed by database transactions.
const ZETUPAY_API = 'https://pay.zetupay.co.ke/api/v1';
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://zetucash-production.up.railway.app').replace(/\/$/, '');

function verifyZetuPaySignature(req) {
  const secret = process.env.ZETUPAY_WEBHOOK_SECRET || process.env.ZETUPAY_SECRET_KEY || '';
  const header = String(req.get('x-zetupay-signature') || '');
  if (!secret || !req.rawBody || !header) return false;
  const parts = Object.fromEntries(header.split(',').map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part.trim(), ''] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
  }));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) >= 300 || !/^[a-f0-9]{64}$/i.test(parts.v1 || '')) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${req.rawBody.toString('utf8')}`).digest();
  const supplied = Buffer.from(parts.v1, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function newPaymentReference(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

async function zetupayRequest(endpoint, body) {
  const secret = process.env.ZETUPAY_SECRET_KEY;
  if (!secret) throw new Error('ZETUPAY_SECRET_KEY is missing in Railway Variables.');
  const response = await fetch(`${ZETUPAY_API}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const error = new Error(data.message || data.error || `ZetuPay request failed (${response.status}).`);
    error.statusCode = response.status;
    throw error;
  }
  return data.data || data;
}

app.post('/api/payments/deposit', dbRequired, authRequired, async (req, res) => {
  const amount = Number(req.body && req.body.amount);
  if (!Number.isSafeInteger(amount) || amount < 10 || amount > 1000000) return res.status(400).json({ error: 'Enter a whole amount from KSh 10 to KSh 1,000,000.' });
  if (!process.env.ZETUPAY_SECRET_KEY) return res.status(503).json({ error: 'ZetuPay is not configured. Add ZETUPAY_SECRET_KEY in Railway Variables.' });
  const reference = newPaymentReference('ZCDEP');
  try {
    await pool.query("INSERT INTO wallet_transactions (reference,user_id,wallet,type,amount,status) VALUES ($1,$2,'savings','DEPOSIT',$3,'PENDING')", [reference, req.user.id, amount]);
    const payment = await zetupayRequest('/payment/initiate', {
      amount,
      phoneNumber: req.user.phone_e164,
      reference,
      redirectUrl: `${PUBLIC_APP_URL}/?payment=return`,
      currency: 'KES',
      identifier: `zetucash-user-${req.user.id}`
    });
    if (!payment.checkoutUrl) throw new Error('ZetuPay did not return a checkout URL. Check the ZetuPay API response.');
    await pool.query('UPDATE wallet_transactions SET provider_id=$1, updated_at=NOW() WHERE reference=$2', [payment.waveTransactionId || payment.paymentKey || null, reference]);
    return res.status(201).json({ success: true, reference, checkoutUrl: payment.checkoutUrl, message: 'Payment created. Complete payment on ZetuPay; your savings balance updates after verified confirmation.' });
  } catch (error) {
    // If ZetuPay explicitly rejected the request, mark it failed. For a network timeout,
    // leave it pending so an accepted payment cannot be accidentally treated as failed.
    if (error.statusCode && error.statusCode < 500) await pool.query("UPDATE wallet_transactions SET status='FAILED', updated_at=NOW() WHERE reference=$1 AND status='PENDING'", [reference]).catch(() => {});
    console.error('ZetuPay deposit initiation error:', error.message);
    return res.status(502).json({ error: error.message || 'Could not start the ZetuPay payment.' });
  }
});

app.post('/api/wallets/withdraw', dbRequired, authRequired, async (req, res) => {
  const wallet = String(req.body && req.body.wallet || '');
  const amount = Number(req.body && req.body.amount);
  if (!['savings', 'loan'].includes(wallet)) return res.status(400).json({ error: 'Choose a valid wallet.' });
  if (!Number.isSafeInteger(amount) || amount < 10 || amount > 1000000) return res.status(400).json({ error: 'Enter a whole withdrawal amount from KSh 10 to KSh 1,000,000.' });
  if (!process.env.ZETUPAY_SECRET_KEY) return res.status(503).json({ error: 'ZetuPay is not configured. Add ZETUPAY_SECRET_KEY in Railway Variables.' });
  const column = wallet === 'savings' ? 'savings_balance' : 'loan_wallet_balance';
  const reference = newPaymentReference('ZCWDR');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(`SELECT ${column} AS balance FROM users WHERE id=$1 FOR UPDATE`, [req.user.id]);
    if (!locked.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Account not found.' }); }
    if (Number(locked.rows[0].balance) < amount) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Insufficient wallet balance.' }); }
    await client.query(`UPDATE users SET ${column}=${column}-$1 WHERE id=$2`, [amount, req.user.id]);
    await client.query("INSERT INTO wallet_transactions (reference,user_id,wallet,type,amount,status) VALUES ($1,$2,$3,'WITHDRAWAL',$4,'PENDING')", [reference, req.user.id, wallet, amount]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Withdrawal reservation error:', error.message);
    return res.status(500).json({ error: 'Could not reserve the withdrawal amount.' });
  } finally { client.release(); }

  try {
    const payout = await zetupayRequest('/payout/b2c', {
      amount,
      phoneNumber: req.user.phone_e164,
      identifier: reference
    });
    await pool.query('UPDATE wallet_transactions SET provider_id=$1, updated_at=NOW() WHERE reference=$2', [payout.payoutID || null, reference]);
    const fresh = await pool.query('SELECT id,full_name,email,phone_e164,savings_balance,loan_wallet_balance,outstanding_debt,created_at FROM users WHERE id=$1', [req.user.id]);
    return res.status(202).json({ success: true, reference, status: payout.status || 'pending', message: 'Withdrawal request submitted. The wallet amount is reserved while ZetuPay processes the payout.', user: safeUser(fresh.rows[0]) });
  } catch (error) {
    // A definite 4xx rejection means no payout was accepted, so return the reserved funds.
    if (error.statusCode && error.statusCode < 500) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txn = await client.query("SELECT user_id,wallet,amount FROM wallet_transactions WHERE reference=$1 AND status='PENDING' FOR UPDATE", [reference]);
        if (txn.rowCount) {
          const balanceColumn = txn.rows[0].wallet === 'savings' ? 'savings_balance' : 'loan_wallet_balance';
          await client.query(`UPDATE users SET ${balanceColumn}=${balanceColumn}+$1 WHERE id=$2`, [txn.rows[0].amount, txn.rows[0].user_id]);
          await client.query("UPDATE wallet_transactions SET status='FAILED',updated_at=NOW() WHERE reference=$1", [reference]);
        }
        await client.query('COMMIT');
      } catch (refundError) { await client.query('ROLLBACK').catch(() => {}); console.error('Withdrawal refund error:', refundError.message); }
      finally { client.release(); }
    }
    console.error('ZetuPay withdrawal initiation error:', error.message);
    return res.status(502).json({ error: error.statusCode && error.statusCode < 500 ? error.message : 'ZetuPay response could not be confirmed. The amount remains reserved pending reconciliation; contact support before retrying.' });
  }
});

// Transaction callback URL: https://zetucash-production.up.railway.app/webhooks/zetupay
app.post('/webhooks/zetupay', async (req, res) => {
  if (!verifyZetuPaySignature(req)) return res.status(401).json({ error: 'Invalid ZetuPay webhook signature.' });
  const payload = req.body && req.body.data && typeof req.body.data === 'object' ? req.body.data : (req.body || {});
  const event = String(req.body && req.body.event || '').toLowerCase();
  if (event && !event.startsWith('payment.')) return res.status(200).json({ received: true, ignored: true });
  const reference = String(payload.reference || payload.identifier || '');
  if (!reference) return res.status(200).json({ received: true, ignored: true });
  if (String(payload.status || '').toLowerCase() !== 'success' && event !== 'payment.success') return res.status(200).json({ received: true, pending: true });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query("SELECT id,user_id,amount,status,type FROM wallet_transactions WHERE reference=$1 FOR UPDATE", [reference]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(200).json({ received: true, notFound: true }); }
    const txn = result.rows[0];
    if (txn.type !== 'DEPOSIT') { await client.query('ROLLBACK'); return res.status(200).json({ received: true, ignored: true }); }
    if (txn.status === 'COMPLETED') { await client.query('ROLLBACK'); return res.status(200).json({ received: true, alreadyProcessed: true }); }
    const paidAmount = Number(payload.amount);
    if (txn.status !== 'PENDING' || !Number.isFinite(paidAmount) || paidAmount !== Number(txn.amount)) { await client.query('ROLLBACK'); console.error('ZetuPay deposit callback amount/status mismatch:', reference); return res.status(200).json({ received: true, mismatch: true }); }
    await client.query('UPDATE users SET savings_balance=savings_balance+$1 WHERE id=$2', [txn.amount, txn.user_id]);
    await client.query("UPDATE wallet_transactions SET status='COMPLETED',provider_id=COALESCE(provider_id,$1),provider_receipt=$2,updated_at=NOW() WHERE id=$3", [payload.waveTransactionId || null, payload.receiptNumber || null, txn.id]);
    await client.query('COMMIT');
    console.log('ZetuCash deposit confirmed:', reference, 'receipt:', payload.receiptNumber || 'not supplied');
    return res.status(200).json({ received: true, credited: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ZetuPay deposit callback error:', error.message);
    return res.status(500).json({ error: 'Could not process callback.' });
  } finally { client.release(); }
});

// Payout callback URL: https://zetucash-production.up.railway.app/webhooks/zetupay/payout
app.post('/webhooks/zetupay/payout', async (req, res) => {
  if (!verifyZetuPaySignature(req)) return res.status(401).json({ error: 'Invalid ZetuPay webhook signature.' });
  const payload = req.body || {};
  const reference = String(payload.identifier || '');
  const status = String(payload.status || '').toLowerCase();
  if (!reference || !['completed', 'success', 'failed'].includes(status)) return res.status(200).json({ received: true, ignored: true });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query("SELECT id,user_id,wallet,amount,status,type FROM wallet_transactions WHERE reference=$1 FOR UPDATE", [reference]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return res.status(200).json({ received: true, notFound: true }); }
    const txn = result.rows[0];
    if (txn.type !== 'WITHDRAWAL' || txn.status !== 'PENDING') { await client.query('ROLLBACK'); return res.status(200).json({ received: true, alreadyProcessed: true }); }
    if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) !== Number(txn.amount)) { await client.query('ROLLBACK'); console.error('ZetuPay payout callback amount mismatch:', reference); return res.status(200).json({ received: true, mismatch: true }); }
    if (status === 'failed') {
      const column = txn.wallet === 'savings' ? 'savings_balance' : 'loan_wallet_balance';
      await client.query(`UPDATE users SET ${column}=${column}+$1 WHERE id=$2`, [txn.amount, txn.user_id]);
      await client.query("UPDATE wallet_transactions SET status='FAILED',provider_id=COALESCE(provider_id,$1),provider_receipt=$2,updated_at=NOW() WHERE id=$3", [payload.payoutID || null, payload.referenceNumber || null, txn.id]);
    } else {
      await client.query("UPDATE wallet_transactions SET status='COMPLETED',provider_id=COALESCE(provider_id,$1),provider_receipt=$2,updated_at=NOW() WHERE id=$3", [payload.payoutID || null, payload.referenceNumber || null, txn.id]);
    }
    await client.query('COMMIT');
    return res.status(200).json({ received: true, updated: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ZetuPay payout callback error:', error.message);
    return res.status(500).json({ error: 'Could not process payout callback.' });
  } finally { client.release(); }
});

app.get('/api/wallets/transactions', dbRequired, authRequired, async (req, res) => {
  try {
    const result = await pool.query('SELECT reference,wallet,type,amount,status,provider_receipt,created_at,updated_at FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    res.json({ transactions: result.rows.map(row => ({ reference: row.reference, wallet: row.wallet, type: row.type, amount: Number(row.amount), status: row.status, receipt: row.provider_receipt, createdAt: row.created_at, updatedAt: row.updated_at })) });
  } catch (error) { console.error('Wallet transactions error:', error.message); res.status(500).json({ error: 'Could not load wallet transactions.' }); }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initializeDatabase().catch(error => { console.error('Database initialization failed:', error.message); }).finally(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`ZetuCash listening on port ${PORT}`));
});
