/**
 * PhonePe Payment Gateway (Standard Checkout, API v2) helper.
 * Docs: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/integration-steps
 *
 * Env:
 *   PHONEPE_ENV               sandbox | production   (default sandbox)
 *   PHONEPE_CLIENT_ID         client id shared by PhonePe
 *   PHONEPE_CLIENT_SECRET     client secret shared by PhonePe
 *   PHONEPE_CLIENT_VERSION    default 1
 *   PHONEPE_WEBHOOK_USERNAME  username/password you typed in the PhonePe dashboard webhook ("SHA" auth type)
 *   PHONEPE_WEBHOOK_PASSWORD
 *
 * Flow: OAuth token -> POST /checkout/v2/pay (returns redirectUrl) -> user pays on PhonePe -> webhook and/or
 * GET /checkout/v2/order/{merchantOrderId}/status (authoritative). Money is only credited after that status call.
 */
const crypto = require('crypto');

const ENV = () => (process.env.PHONEPE_ENV === 'production' ? 'production' : 'sandbox');
const AUTH_URL = () => (ENV() === 'production'
  ? 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token');
const PG_BASE = () => (ENV() === 'production'
  ? 'https://api.phonepe.com/apis/pg'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox');

function isConfigured() {
  return Boolean(process.env.PHONEPE_CLIENT_ID && process.env.PHONEPE_CLIENT_SECRET);
}

let tokenCache = { token: '', expiresAtMs: 0, env: '' };
let tokenInFlight = null;

async function fetchToken() {
  const body = new URLSearchParams({
    client_id: process.env.PHONEPE_CLIENT_ID,
    client_version: String(process.env.PHONEPE_CLIENT_VERSION || '1'),
    client_secret: process.env.PHONEPE_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });
  const res = await fetch(AUTH_URL(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(12000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(data.message || data.error_description || `PhonePe auth failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const expiresAtMs = Number(data.expires_at) > 0 ? Number(data.expires_at) * 1000 : Date.now() + 10 * 60 * 1000;
  tokenCache = { token: data.access_token, expiresAtMs, env: ENV() };
  return tokenCache.token;
}

// Cached until one minute before expiry; concurrent callers share one in-flight request.
async function getToken() {
  if (tokenCache.token && tokenCache.env === ENV() && Date.now() < tokenCache.expiresAtMs - 60 * 1000) return tokenCache.token;
  if (!tokenInFlight) tokenInFlight = fetchToken().finally(() => { tokenInFlight = null; });
  return tokenInFlight;
}

async function call(method, path, body, retried = false) {
  const token = await getToken();
  const res = await fetch(`${PG_BASE()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `O-Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) { tokenCache = { token: '', expiresAtMs: 0, env: '' }; return call(method, path, body, true); }
  if (!res.ok) {
    const err = new Error(data.message || data.code || `PhonePe request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code || '';
    throw err;
  }
  return data;
}

// Creates a checkout and returns { orderId, state, expireAt, redirectUrl }. amountPaise must be an integer >= 100.
function createPayment({ merchantOrderId, amountPaise, redirectUrl, message, expireAfterSeconds = 1800, udf1 = '' }) {
  return call('POST', '/checkout/v2/pay', {
    merchantOrderId,
    amount: Math.round(Number(amountPaise)),
    expireAfter: expireAfterSeconds,
    metaInfo: udf1 ? { udf1: String(udf1).slice(0, 256) } : undefined,
    paymentFlow: {
      type: 'PG_CHECKOUT',
      message: String(message || 'PresetHub payment').slice(0, 100),
      merchantUrls: { redirectUrl }
    }
  });
}

// Authoritative status: { state: PENDING | COMPLETED | FAILED, amount (paise), orderId, paymentDetails: [...] }.
function fetchStatus(merchantOrderId) {
  return call('GET', `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false`);
}

// Webhook authentication: PhonePe sends Authorization = SHA256("username:password") for the credentials set in the dashboard.
function expectedWebhookAuth() {
  const u = process.env.PHONEPE_WEBHOOK_USERNAME;
  const p = process.env.PHONEPE_WEBHOOK_PASSWORD;
  if (!u || !p) return '';
  return crypto.createHash('sha256').update(`${u}:${p}`).digest('hex');
}
function verifyWebhookAuth(headerValue) {
  const expected = expectedWebhookAuth();
  const given = String(headerValue || '').trim().replace(/^SHA256\s+/i, '').toLowerCase();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Amount (paise) must match what we stored, to the paisa.
function amountMatches(order, status) {
  return Math.round(Number(order.amount) * 100) === Math.round(Number(status.amount));
}

module.exports = { isConfigured, createPayment, fetchStatus, verifyWebhookAuth, expectedWebhookAuth, amountMatches, ENV, getToken };
