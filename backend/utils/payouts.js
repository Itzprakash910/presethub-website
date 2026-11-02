/**
 * Pure payout rules. Money is handled in integer paise to avoid float errors.
 */
const CREATOR_SHARE = () => {
  const v = Number(process.env.CREATOR_SHARE || 0.8);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8;
};
const MIN_PAYOUT_PAISE = () => Math.round(Number(process.env.PAYOUT_MIN_RUPEES || 100) * 100);

const toPaise = rupees => Math.round(Number(rupees || 0) * 100);
// Creator's share of a gross amount, rounded down to whole paise.
function creatorShare(grossPaise) {
  return Math.floor(Number(grossPaise || 0) * CREATOR_SHARE());
}

function validateUpi(v) {
  const s = String(v || '').trim();
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(s) ? s : null;
}
function validateIfsc(v) {
  const s = String(v || '').trim().toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s) ? s : null;
}
function validateAccount(v) {
  const s = String(v || '').replace(/\s+/g, '');
  return /^[0-9]{9,18}$/.test(s) ? s : null;
}
function validateName(v) {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  return s.length >= 3 && s.length <= 100 ? s : null;
}
function maskAccount(acc) { const s = String(acc || ''); return s.length > 4 ? '•'.repeat(s.length - 4) + s.slice(-4) : '••••'; }
function maskUpi(upi) { const [a, b] = String(upi || '').split('@'); if (!a || !b) return '••••'; return `${a.slice(0, 2)}${'•'.repeat(Math.max(2, a.length - 2))}@${b}`; }

// balance = earned - (requested + approved + paid). All values in paise.
function balance({ earnedPaise, committedPaise }) {
  return Math.max(0, Number(earnedPaise || 0) - Number(committedPaise || 0));
}

module.exports = { CREATOR_SHARE, MIN_PAYOUT_PAISE, toPaise, creatorShare, validateUpi, validateIfsc, validateAccount, validateName, maskAccount, maskUpi, balance };
