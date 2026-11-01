/**
 * Clerk integration (server side). Sessions are verified with Clerk's JWKS through @clerk/backend.
 * Env: CLERK_SECRET_KEY (server only), CLERK_PUBLISHABLE_KEY (sent to the browser).
 */
const AUTHORIZED = () => [String(process.env.CLIENT_URL || 'https://presethub.site').replace(/\/+$/, ''), 'https://www.presethub.site'];

function isConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
}

function lib() {
  try { return require('@clerk/backend'); }
  catch (_) { throw Object.assign(new Error('Authentication library missing. Run npm install in backend/.'), { status: 503 }); }
}

// Returns the verified JWT payload (payload.sub = Clerk user id). Throws if the token is invalid or expired.
async function verifySession(token) {
  const { verifyToken } = lib();
  const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY, authorizedParties: AUTHORIZED() });
  if (!payload || !payload.sub) throw new Error('Invalid Clerk session');
  return payload;
}

function client() {
  const { createClerkClient } = lib();
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
}

// Profile data for linking: the primary email is used only when Clerk marks it as verified.
async function getClerkUser(sub) {
  const u = await client().users.getUser(sub);
  const primary = (u.emailAddresses || []).find(e => e.id === u.primaryEmailAddressId) || (u.emailAddresses || [])[0];
  return {
    id: u.id,
    email: primary ? String(primary.emailAddress || '').toLowerCase() : '',
    verified: Boolean(primary && primary.verification && primary.verification.status === 'verified'),
    name: [u.firstName, u.lastName].filter(Boolean).join(' ').slice(0, 100),
    username: u.username || '',
    imageUrl: u.imageUrl || '',
    mfa: Boolean(u.twoFactorEnabled || u.totpEnabled || u.backupCodeEnabled)
  };
}

async function deleteClerkUser(sub) {
  await client().users.deleteUser(sub);
}

module.exports = { isConfigured, verifySession, getClerkUser, deleteClerkUser };
