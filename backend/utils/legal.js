'use strict';
/**
 * Legal versions and the business/grievance details shown on the Privacy, Refund and Contact pages.
 * The details come from environment variables so the real names and addresses never sit in the code as placeholders.
 */
const PRIVACY_VERSION = '2026-11-03';
const TERMS_VERSION = '2026-07-29';
const COOKIE_VERSION = '2026-11-03';

const clip = (v, n) => String(v || '').replace(/[\u0000-\u001F<>]/g, ' ').trim().slice(0, n);

function legalContact() {
  return {
    entityName: clip(process.env.LEGAL_ENTITY_NAME, 150),
    address: clip(process.env.LEGAL_ADDRESS, 300),
    officerName: clip(process.env.GRIEVANCE_OFFICER_NAME, 100),
    officerEmail: clip(process.env.GRIEVANCE_OFFICER_EMAIL || 'support@presethub.site', 120),
    officerAddress: clip(process.env.GRIEVANCE_OFFICER_ADDRESS || process.env.LEGAL_ADDRESS, 300),
    supportEmail: clip(process.env.SUPPORT_EMAIL || 'support@presethub.site', 120),
    privacyVersion: PRIVACY_VERSION, termsVersion: TERMS_VERSION, cookieVersion: COOKIE_VERSION
  };
}
// Names the required details that are still empty (used for a startup warning and the admin checklist).
function missingLegalFields() {
  const c = legalContact();
  return [['LEGAL_ENTITY_NAME', c.entityName], ['LEGAL_ADDRESS', c.address], ['GRIEVANCE_OFFICER_NAME', c.officerName]].filter(([, v]) => !v).map(([k]) => k);
}
module.exports = { PRIVACY_VERSION, TERMS_VERSION, COOKIE_VERSION, legalContact, missingLegalFields };
