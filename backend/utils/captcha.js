'use strict';
/**
 * Optional Cloudflare Turnstile CAPTCHA for public forms (signup, password reset).
 * Off until BOTH TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set, so nothing changes for existing deployments.
 * When on, the server verifies every token with Cloudflare; if verification cannot be completed the request is refused (fail closed).
 */
const enabled = () => Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
const siteKey = () => (enabled() ? process.env.TURNSTILE_SITE_KEY : '');

async function verify(token, ip) {
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: String(token || '').slice(0, 2048) });
  if (ip) body.set('remoteip', String(ip));
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000) });
  const data = await res.json().catch(() => ({}));
  return data && data.success === true;
}

async function requireCaptcha(req, res, next) {
  if (!enabled()) return next();
  const token = typeof req.body?.captchaToken === 'string' ? req.body.captchaToken : '';
  if (!token) return res.status(400).json({ code: 'CAPTCHA_REQUIRED', error: 'Please complete the “I am human” check and try again.' });
  try {
    if (await verify(token, req.ip)) return next();
    return res.status(400).json({ code: 'CAPTCHA_FAILED', error: 'The human check failed. Please try again.' });
  } catch (_) {
    return res.status(503).json({ code: 'CAPTCHA_UNAVAILABLE', error: 'The human check is temporarily unavailable. Please try again in a minute.' });
  }
}

module.exports = { enabled, siteKey, requireCaptcha, verify };
