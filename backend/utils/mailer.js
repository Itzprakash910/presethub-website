'use strict';
/** Sends transactional e-mail to a user through Resend (same provider/keys as the password-reset mail). Never throws. */
function canSendMail() { return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM); }

async function sendUserMail(to, subject, html) {
  if (!canSendMail() || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(10000)
    });
    return r.ok;
  } catch (_) { return false; }
}
module.exports = { canSendMail, sendUserMail };
