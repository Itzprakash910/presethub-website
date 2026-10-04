const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { User, Preset, Download, Share, ShortLink, ShareClick, Comment, Message, Order } = require('../models');
const { deleteFromMongo } = require('../config/mongoStorage');

function strongPassword(value) {
  const p = String(value || '');
  return p.length >= 10 && p.length <= 128 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p);
}

function signUserToken(user) {
  return jwt.sign({ id: user._id.toString(), email: user.email, role: user.role, ver: Number(user.sessionVersion || 0) }, JWT_SECRET, { expiresIn: '7d' });
}
const auth = require('../middleware/auth');
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15,
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

function generateUniqueUsername(email, existing) {
  let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  if (base.length < 3) base = base.padEnd(3, '0');
  let u = base, s = 1;
  while (existing.includes(u) && s <= 100) u = `${base}${s++}`;
  if (existing.includes(u)) u = `${base}${Date.now().toString().slice(-6)}`;
  return u;
}

router.post('/signup', validate(signupValidation), async (req, res) => {
  try {
    let { email, password, name, username } = req.body;
    email = email.toLowerCase().trim();

    if (await User.exists({ email })) return res.status(409).json({ error: 'User already exists' });

    const existing = await User.distinct('username', { username: { $ne: null } });
    if (!username) username = generateUniqueUsername(email, existing);
    else {
      username = username.toLowerCase().trim().replace(/[^a-z0-9_]/g, '');
      if (existing.includes(username)) username = generateUniqueUsername(email, existing);
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = new User({
      email, password: hashed,
      name: name || username, username, role: 'user', verified: true
    });

    const refCode = req.query.ref;
    if (refCode) {
      const referrer = await User.findOne({ 'referral.code': refCode });
      if (referrer) {
        user.referral.referredBy = referrer._id;
        referrer.referral.referralCount = (referrer.referral.referralCount || 0) + 1;
        if (referrer.referral.referralCount % 10 === 0) {
          const now = new Date();
          let expiry = referrer.subscription?.expiry ? new Date(referrer.subscription.expiry) : now;
          if (expiry < now) expiry = now;
          expiry.setDate(expiry.getDate() + 28);
          referrer.subscription.expiry = expiry;
          referrer.referral.referralRewardDays = (referrer.referral.referralRewardDays || 0) + 28;
        }
        await referrer.save();
      }
    }

    await user.save();

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

router.post('/login', validate(loginValidation), async (req, res) => {
  try {
    const email = req.body.email.toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.status === 'blocked' || user.status === 'deactivated' || !await bcrypt.compare(req.body.password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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
        createdAt: user.createdAt, verified: user.verified, subscription: user.subscription
      }
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -token -passwordResetTokenHash -passwordResetExpires -pushSubscriptions -sessionVersion').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: { ...user, id: user._id.toString() } });
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



router.post('/request-reset', async (req, res) => {
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
      Order.deleteMany({ userId:user._id }),
      User.updateMany({ followers:user._id }, { $pull:{ followers:user._id } }),
      User.updateMany({ following:user._id }, { $pull:{ following:user._id } }),
      User.updateMany({ 'referral.referredBy': user._id }, { $set:{ 'referral.referredBy': null } })
    ]);
    await User.deleteOne({ _id:user._id });
    res.clearCookie('ph_auth', { httpOnly:true, secure:process.env.NODE_ENV === 'production', sameSite:'lax', path:'/' });
    res.json({ success:true, message:'Your PresetHub account and associated data have been permanently deleted.' });
  } catch (e) { console.error('Account deletion error:', e); res.status(500).json({ error:'Account deletion failed. Please try again.' }); }
});

router.post('/logout', auth, (req, res) => {
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

module.exports = router;