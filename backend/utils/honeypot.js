'use strict';
/**
 * Invisible bot trap for public forms. Real visitors never see or fill the hidden field `company_website`; simple bots fill every input.
 * A filled trap gets the same friendly answer as a success but nothing is created or sent, so the bot learns nothing.
 */
const FIELD = 'company_website';
function honeypot(fakeResponse) {
  return (req, res, next) => {
    const v = req.body && req.body[FIELD];
    if (typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null && v !== '') {
      try { require('./alerts').securityAlert(req, 'Honeypot field filled (bot form submission dropped)', { path: req.path }, 'info', 60 * 60 * 1000); } catch (_) {}
      return res.json(fakeResponse);
    }
    next();
  };
}
module.exports = { honeypot, FIELD };
