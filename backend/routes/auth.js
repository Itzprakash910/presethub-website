const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { User, Preset, Download, Share, ShortLink, ShareClick, Comment, Message, Order } = require('../models');
const { deleteFromMongo } = require('../config/mongoStorage');
const { adminAlert, recordFailedLogin, clearFailedLogins, requestInfo } = require('../utils/alerts');
const { isProUser } = require('../utils/plans');
const { tickForFollowers } = require('../utils/tick');
const { isLockedOut, noteLoginFailure, clearLoginFailures, signupLimiter, resetLimiter } = require('../utils/security');

function strongPassword(value) {
  const p = String(value || '');
  return p.length >= 10 && p.length <= 128 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p);
}

function signUserToken(user) {
  return jwt.sign({ id: user._id.toString(), email: user.email, role: user.role, ver: Number(user.sessionVersion || 0) }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
}
const auth = require('../middleware/auth');
const legal = require('../utils/legal');
const totp = require('../utils/totp');
const cryptoBox = require('../utils/crypto');
const { validate, signupValidation, loginValidation, changePasswordValidation } = require('../utils/validators');

const router = express.Router();
function cleanSocialLinks(value) {
  const out = {};
  for (const key of ['instagram','youtube','twitter','website']) {
    const v = String(value?.[key] || '').trim();
    out[key] = /^(https?:\/\/)/i.test(v) ? v.slice(0, 300) : '';
  }
  return out;
}

const JWT_SECRET = process.env.JWT_SECRET;

// Only writes (login, signup, password change...) are counted. GET /me runs on every page load and must never be
// rate-limited here, otherwise a shared mobile IP gets 429 and the app wrongly shows the visitor as logged out.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15,
  skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' }
});
router.use(authLimiter);


function setAuthCookie(res, token) {
  res.cookie('ph_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

// Checks the database one candidate at a time (indexed lookup) instead of loading every username on each signup.
async function generateUniqueUsername(email) {
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'user';
  if (base.length < 3) base = base.padEnd(3, '0');
  let u = base, s = 1;
  while (s <= 100 && await User.exists({ username: u })) u = `${base}${s++}`;
  if (await User.exists({ username: u })) u = `${base}${Date.now().toString().slice(-6)}`;
  return u;
}

router.post('/signup', signupLimiter, validate(signupValidation), async (req, res) => {
  try {
    let { email, password, name, username } = req.body;
    email = email.toLowerCase().trim();

    if (await User.exists({ email })) return res.status(409).json({ error: 'User already exists' });

    if (!username) username = await generateUniqueUsername(email);
    else {
      username = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
      if (username.length < 3 || await User.exists({ username })) username = await generateUniqueUsername(email);
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = new User({
      email, password: hashed,
      name: name || username, username, role: 'user', verified: true,
      consent: { termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, acceptedAt: new Date(), ageConfirmed: true, source: 'web-signup' }
    });

    // Referral: remember who referred this user; the reward is given only after the account is saved (below).
    const refCode = String(req.query.ref || '').slice(0, 40);
    let referrerId = null;
    if (refCode) {
      const referrer = await User.findOne({ 'referral.code': refCode }).select('_id').lean();
      if (referrer) { user.referral.referredBy = referrer._id; referrerId = referrer._id; }
    }

    await user.save();

    if (referrerId) {
      try {
        // Atomic counter: two signups at the same moment can no longer overwrite each other's count.
        const bumped = await User.findOneAndUpdate({ _id: referrerId }, { $inc: { 'referral.referralCount': 1 } }, { new: true }).select('referral.referralCount subscription.expiry').lean();
        if (bumped && bumped.referral.referralCount % 10 === 0) {
          const now = new Date();
          let expiry = bumped.subscription?.expiry ? new Date(bumped.subscription.expiry) : now;
          if (expiry < now) expiry = now;
          expiry.setDate(expiry.getDate() + 28);
          await User.updateOne({ _id: referrerId }, { $set: { 'subscription.expiry': expiry }, $inc: { 'referral.referralRewardDays': 28 } });
        }
      } catch (refErr) { console.warn('Referral reward failed:', refErr.message); }
    }

    adminAlert({
      type: 'new_user', severity: 'info', title: `New user joined: ${user.name || user.username}`, throttleMs: 1000,
      fingerprint: `new-user-${user._id}`,
      details: { name: user.name, username: user.username, email: user.email, referredBy: user.referral?.referredBy ? String(user.referral.referredBy) : 'none', ...requestInfo(req) }
    });

    const token = signUserToken(user);

    setAuthCookie(res, token);
    res.status(201).json({
      success: true,
      user: {
        id: user._id.toString(), name: user.name, email: user.email,
        role: user.role, username: user.username, avatar: user.avatar,
        createdAt: user.createdAt, verified: user.verified
      }
    });
  } catch (e) {
    console.error('Signup error:', e);
    if (e?.code === 11000) {
      const field = Object.keys(e.keyPattern || e.keyValue || {})[0] || 'account';
      return res.status(409).json({ error: field === 'email' ? 'User already exists' : 'Username already in use', code: 'DUPLICATE_KEY', field });
    }
    res.status(500).json({ error: 'Signup failed' });
  }
});

const DUMMY_HASH = bcrypt.hashSync('presethub-dummy-password', 12);

// Checks an authenticator code (each 30-second code works once) or a one-time backup code.
async function verifyMfaCode(user, code) {
  const c = String(code || '').trim();
  if (totp.looksLikeBackupCode(c)) {
    const h = totp.hashCode(c);
    const r = await User.updateOne({ _id: user._id, mfaBackupHashes: h }, { $pull: { mfaBackupHashes: h } });
    return r.modifiedCount === 1;
  }
  if (!user.mfaSecretEnc) return false;
  let secret;
  try { secret = cryptoBox.decrypt(user.mfaSecretEnc); } catch (_) { return false; }
  const step = totp.verifyTotp(secret, c);
  if (step === null) return false;
  const r = await User.updateOne({ _id: user._id, mfaLastStep: { $lt: step } }, { $set: { mfaLastStep: step } });
  return r.modifiedCount === 1; // a code that was already used is refused
}

router.post('/login', validate(loginValidation), async (req, res) => {
  try {
    const email = req.body.email.toLowerCase().trim();
    const locked = isLockedOut(email, req);
    if (locked) return res.status(429).json({ error: `Too many wrong attempts. Try again in about ${locked} minute(s), or use "Forgot password".` });
    const user = await User.findOne({ email }).select('+mfaSecretEnc +mfaLastStep +mfaBackupHashes');
    if (!user) {
      // Same bcrypt work as a real login so response time does not reveal which emails exist.
      await bcrypt.compare(String(req.body.password || ''), DUMMY_HASH).catch(() => {});
      recordFailedLogin(req, email); noteLoginFailure(email, req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status === 'blocked' || user.status === 'deactivated' || !await bcrypt.compare(req.body.password, user.password)) {
      recordFailedLogin(req, email); noteLoginFailure(email, req);
      if (user.role === 'admin') adminAlert({ type: 'security', severity: 'critical', title: 'Failed login on ADMIN account', fingerprint: `admin-fail-${req.ip}`, details: { ...requestInfo(req), email } });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Admin two-step verification: a password alone is not enough once it is switched on.
    if (user.role === 'admin' && user.mfaEnabled) {
      const code = String(req.body.mfaCode || '').trim();
      if (!code) return res.status(401).json({ error: 'Enter your two-step verification code.', code: 'MFA_REQUIRED' });
      if (!(await verifyMfaCode(user, code))) {
        recordFailedLogin(req, email); noteLoginFailure(email, req);
        adminAlert({ type: 'security', severity: 'critical', title: 'Wrong two-step code on ADMIN account', fingerprint: `admin-mfa-fail-${req.ip}`, details: { ...requestInfo(req) } });
        return res.status(401).json({ error: 'Invalid two-step code.', code: 'MFA_INVALID' });
      }
    }
    clearFailedLogins(req, email); clearLoginFailures(email, req);
    if (user.role === 'admin') adminAlert({ type: 'security', severity: 'warning', title: 'Admin logged in', fingerprint: `admin-login-${req.ip}`, throttleMs: 30 * 60 * 1000, details: { ...requestInfo(req), email } });

    user.lastLogin = new Date();
    user.lastActive = new Date();
    await user.save();

    const token = signUserToken(user);

    setAuthCookie(res, token);
    res.json({
      success: true,
      user: {
        id: user._id.toString(), name: user.name, email: user.email,
        role: user.role, username: user.username, avatar: user.avatar,
        createdAt: user.createdAt, verified: user.verified, subscription: user.subscription, isPro: isProUser(user)
      }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logged-out visitors call /me on every page load. Answer 200 { user: null } when no credentials are sent at all,
// so the browser console (and Lighthouse "Best Practices") is not filled with 401 errors. Invalid/expired tokens still get 401.
const softMe = (req, res, next) => {
  const hasHeader = !!req.header('Authorization');
  const hasCookie = !!(req.cookies && req.cookies.ph_auth);
  if (!hasHeader && !hasCookie) return res.json({ success: true, user: null });
  next();
};

router.get('/me', softMe, auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -token -passwordResetTokenHash -passwordResetExpires -pushSubscriptions -sessionVersion -botLinkHash -botLinkExpires').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: { ...user, id: user._id.toString(), isPro: isProUser(user), tick: tickForFollowers((user.followers || []).length) } });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/profile', auth, async (req, res) => {
  try {
    const { name, username, bio, avatar, socialLinks } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (username && username !== user.username) {
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(String(username).trim())) return res.status(400).json({ error: 'Invalid username' });
      if (await User.exists({ username: username.toLowerCase(), _id: { $ne: user._id } }))
        return res.status(409).json({ error: 'Username taken' });
      user.username = username.toLowerCase().trim();
    }
    if (name) user.name = String(name).trim().slice(0, 50);
    if (bio !== undefined) user.bio = String(bio).trim().slice(0, 500);
    if (avatar !== undefined) {
      const av = String(avatar || '').trim();
      if (av && !/^\/media\/[a-f0-9]{24}$/i.test(av)) return res.status(400).json({ error: 'Invalid avatar media URL' });
      user.avatar = av;
    }
    if (socialLinks) user.socialLinks = { ...(user.socialLinks?.toObject?.() || {}), ...cleanSocialLinks(socialLinks) };

    await user.save();
    const safe = user.toObject();
    delete safe.password;
    delete safe.token;
    delete safe.passwordResetTokenHash;
    delete safe.passwordResetExpires;
    delete safe.pushSubscriptions;
    delete safe.sessionVersion;
    delete safe.botLinkHash;
    delete safe.botLinkExpires;
    safe.id = safe._id.toString();
    res.json({ success: true, user: safe });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/change-password', auth, validate(changePasswordValidation), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!await bcrypt.compare(req.body.currentPassword, user.password))
      return res.status(401).json({ error: 'Current password incorrect' });

    if (!strongPassword(req.body.newPassword)) return res.status(400).json({ error: 'New password must be 10+ characters and include uppercase, lowercase and a number' });
    user.password = await bcrypt.hash(req.body.newPassword, 12);
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    await user.save();
    res.json({ success: true, message: 'Password changed' });
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});



router.post('/request-reset', resetLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    // Always return the same public response to avoid account enumeration.
    const generic = { success: true, message: 'If that email exists, a password reset link has been sent.' };
    if (!email) return res.json(generic);
    const user = await User.findOne({ email });
    if (!user) return res.json(generic);
    const raw = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    const resetUrl = `${(process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, '')}/?reset=${raw}`;
    if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) {
      try {
        await fetch('https://api.resend.com/emails', { method:'POST', headers:{'Authorization':`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'}, body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject:'PresetHub password reset',html:`<p>Reset your PresetHub password:</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in 30 minutes.</p>`}) });
      } catch(e) { console.error('Reset email send failed:',e.message); }
    } else if (process.env.NODE_ENV !== 'production') {
      console.log('DEV PASSWORD RESET URL:', resetUrl);
    }
    return res.json(generic);
  } catch(e) { console.error('Password reset request:',e); res.json({success:true,message:'If that email exists, a password reset link has been sent.'}); }
});

router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    if (!token || !strongPassword(password)) return res.status(400).json({error:'Valid reset token and a strong 10+ character password are required'});
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({passwordResetTokenHash:hash,passwordResetExpires:{$gt:new Date()}});
    if (!user) return res.status(400).json({error:'Reset link is invalid or expired'});
    user.password = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = '';
    user.passwordResetExpires = null;
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    await user.save();
    res.json({success:true,message:'Password reset successfully'});
  } catch(e){ res.status(500).json({error:'Password reset failed'}); }
});
router.delete('/account', auth, async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!password) return res.status(400).json({ error: 'Enter your password to permanently delete the account' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Admin accounts cannot be deleted from the user settings.' });
    if (await require('../models').Payout.exists({ userId: user._id, status: { $in: ['requested', 'approved'] } })) {
      return res.status(409).json({ error: 'You have a payout that is still being processed. Please wait until it is paid or rejected, then delete your account.', code: 'PAYOUT_PENDING' });
    }
    if (!user.password || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Password is incorrect' });

    const avatarUrl = user.avatar || '';
    const presets = await Preset.find({ authorId: user._id }).select('fileUrl previewImage').lean();
    await deleteFromMongo(avatarUrl).catch(() => {});
    await Promise.all(presets.flatMap(p => [deleteFromMongo(p.fileUrl), deleteFromMongo(p.previewImage)]));
    const presetIds = presets.map(p => p._id);
    await Promise.all([
      Preset.deleteMany({ authorId: user._id }),
      Download.deleteMany({ $or: [{ userId:user._id }, { presetId:{ $in:presetIds } }] }),
      Share.deleteMany({ $or: [{ userId:user._id }, { presetId:{ $in:presetIds } }] }),
      ShareClick.deleteMany({ $or: [{ userId:user._id }, { presetId:{ $in:presetIds } }] }),
      ShortLink.deleteMany({ $or: [{ userId:user._id }, { presetId:{ $in:presetIds } }] }),
      Comment.deleteMany({ $or: [{ userId:user._id }, { presetId:{ $in:presetIds } }] }),
      Message.deleteMany({ $or:[{ senderId:user._id }, { receiverId:user._id }] }),
      // Orders are financial records that the Privacy Policy says we keep as long as the law requires.
      // They hold no name, email or phone; the link to the person disappears with the user record below.
      User.updateMany({ followers:user._id }, { $pull:{ followers:user._id } }),
      User.updateMany({ following:user._id }, { $pull:{ following:user._id } }),
      User.updateMany({ 'referral.referredBy': user._id }, { $set:{ 'referral.referredBy': null } })
    ]);
    await User.deleteOne({ _id:user._id });
    res.clearCookie('ph_auth', { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax', path:'/' });
    res.json({ success:true, message:'Your PresetHub account and associated data have been permanently deleted.' });
  } catch (e) { console.error('Account deletion error:', e); res.status(500).json({ error:'Account deletion failed. Please try again.' }); }
});

router.post('/logout', (req, res) => {
  res.clearCookie('ph_auth', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.json({ success: true });
});
router.post('/refresh-token', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('email role sessionVersion').lean();
  if (!user) return res.status(401).json({ error: 'User not found' });
  const token = signUserToken(user);
  setAuthCookie(res, token);
  res.json({ success: true });
});


// Telegram linking: one-time 6-digit code (valid 10 minutes, stored hashed).
router.post('/bot-link-code', auth, async (req, res) => {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  await User.updateOne({ _id: req.user.id }, { $set: { botLinkHash: hash, botLinkExpires: new Date(Date.now() + 10 * 60 * 1000) } });
  res.json({ code, expiresInMinutes: 10, instructions: 'Telegram bot par /link ' + code + ' bhejein.' });
});

// DPDP access right: the signed-in user's own data as JSON (no password hashes or secrets).
router.get('/my-data', auth, async (req, res) => {
  const M = require('../models');
  const uid = req.user.id;
  const [user, orders, presets, texts, payouts, comments] = await Promise.all([
    User.findById(uid).select('name username email phone bio avatar createdAt subscription tipsTotal').lean(),
    M.Order.find({ userId: uid }).select('kind amount status createdAt couponCode').sort({ createdAt: -1 }).limit(1000).lean(),
    M.Preset.find({ authorId: uid }).select('name category price status createdAt').lean(),
    M.TextPost.find({ authorId: uid }).select('title category status createdAt').lean(),
    M.Payout.find({ userId: uid }).select('amountPaise method destinationMasked status createdAt').lean(),
    M.Comment.find({ userId: uid }).select('text createdAt').limit(1000).lean()
  ]);
  res.set('Content-Disposition', `attachment; filename="presethub-my-data-${new Date().toISOString().slice(0, 10)}.json"`);
  res.set('Cache-Control', 'no-store');
  res.json({
    exportedAt: new Date().toISOString(),
    profile: user ? { name: user.name, username: user.username, email: user.email, phone: user.phone || '', bio: user.bio || '', createdAt: user.createdAt, pro: user.subscription || null } : null,
    orders: orders.map(o => ({ id: String(o._id), kind: o.kind, amountRupees: o.amount, status: o.status, coupon: o.couponCode || '', createdAt: o.createdAt })),
    presets: presets.map(p => ({ id: String(p._id), name: p.name, category: p.category, price: p.price, status: p.status, createdAt: p.createdAt })),
    textPosts: texts.map(t => ({ id: String(t._id), title: t.title || '', category: t.category, status: t.status, createdAt: t.createdAt })),
    payouts: payouts.map(x => ({ id: String(x._id), amountRupees: Math.round(x.amountPaise) / 100, method: x.method, destination: x.destinationMasked, status: x.status, createdAt: x.createdAt })),
    comments: comments.map(c => ({ text: c.text, createdAt: c.createdAt }))
  });
});

// ---------- Admin two-step verification (TOTP) ----------
const adminOnly = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));

router.get('/mfa/status', auth, adminOnly, async (req, res) => {
  const u = await User.findById(req.user.id).select('mfaEnabled mfaEnabledAt +mfaBackupHashes').lean();
  res.json({ enabled: !!(u && u.mfaEnabled), enabledAt: u && u.mfaEnabledAt || null, backupCodesLeft: u && u.mfaEnabled ? (u.mfaBackupHashes || []).length : 0, available: cryptoBox.isKeyConfigured() });
});
router.post('/mfa/setup', auth, adminOnly, async (req, res) => {
  try {
    if (!cryptoBox.isKeyConfigured()) return res.status(503).json({ error: 'Set PAYOUT_ENC_KEY on the server first (it also protects the two-step secret).' });
    const u = await User.findById(req.user.id).select('email mfaEnabled').lean();
    if (u.mfaEnabled) return res.status(409).json({ error: 'Two-step verification is already on. Turn it off first to set it up again.' });
    const secret = totp.generateSecret();
    await User.updateOne({ _id: req.user.id }, { $set: { mfaSecretEnc: cryptoBox.encrypt(secret), mfaEnabled: false } });
    res.json({ secret, otpauthUrl: totp.otpauthUrl(u.email, secret) });
  } catch (e) { console.error('MFA setup error:', e.message); res.status(500).json({ error: 'Could not start two-step setup.' }); }
});
router.post('/mfa/enable', auth, adminOnly, async (req, res) => {
  try {
    const u = await User.findById(req.user.id).select('+mfaSecretEnc mfaEnabled');
    if (u.mfaEnabled) return res.status(409).json({ error: 'Two-step verification is already on.' });
    if (!u.mfaSecretEnc) return res.status(400).json({ error: 'Start the setup first.' });
    let secret;
    try { secret = cryptoBox.decrypt(u.mfaSecretEnc); } catch (_) { return res.status(400).json({ error: 'Start the setup again.' }); }
    const step = totp.verifyTotp(secret, req.body && req.body.code);
    if (step === null) return res.status(400).json({ error: 'That code is not correct. Check the time on your phone and try again.' });
    const backup = totp.generateBackupCodes();
    await User.updateOne({ _id: u._id }, { $set: { mfaEnabled: true, mfaEnabledAt: new Date(), mfaLastStep: step, mfaBackupHashes: backup.hashes } });
    adminAlert({ type: 'security', severity: 'info', title: 'Admin turned ON two-step verification', fingerprint: `admin-mfa-on-${u._id}`, email: false, details: { ...requestInfo(req) } });
    res.json({ enabled: true, backupCodes: backup.codes }); // shown once; only hashes are stored
  } catch (e) { console.error('MFA enable error:', e.message); res.status(500).json({ error: 'Could not turn on two-step verification.' }); }
});
router.post('/mfa/disable', auth, adminOnly, async (req, res) => {
  try {
    const u = await User.findById(req.user.id).select('+password +mfaSecretEnc +mfaLastStep +mfaBackupHashes mfaEnabled');
    if (!u.mfaEnabled) return res.json({ enabled: false });
    if (!u.password || !(await bcrypt.compare(String(req.body && req.body.password || ''), u.password))) return res.status(401).json({ error: 'Password is incorrect.' });
    if (!(await verifyMfaCode(u, req.body && req.body.code))) return res.status(401).json({ error: 'Two-step code is incorrect.' });
    await User.updateOne({ _id: u._id }, { $set: { mfaEnabled: false, mfaEnabledAt: null, mfaSecretEnc: '', mfaLastStep: 0, mfaBackupHashes: [] } });
    adminAlert({ type: 'security', severity: 'warning', title: 'Admin turned OFF two-step verification', fingerprint: `admin-mfa-off-${u._id}`, details: { ...requestInfo(req) } });
    res.json({ enabled: false });
  } catch (e) { console.error('MFA disable error:', e.message); res.status(500).json({ error: 'Could not turn off two-step verification.' }); }
});

module.exports = router;