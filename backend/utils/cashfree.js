/**
 * Cashfree Payment Gateway (PG) helper — REST API + webhook signature.
 * Docs: https://docs.cashfree.com/reference/pg-new-apis-endpoint
 *
 * Env:
 *   CASHFREE_ENV          sandbox | production   (default sandbox)
 *   CASHFREE_APP_ID       x-client-id
 *   CASHFREE_SECRET_KEY   x-client-secret (also used to sign webhooks)
 *   CASHFREE_API_VERSION  default 2025-01-01
 */
const crypto = require('crypto');

const API_VERSION = () => process.env.CASHFREE_API_VERSION || '2025-01-01';
const ENV = () => (process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox');
const BASE = () => (ENV() === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg');
const MAX_WEBHOOK_AGE_MS = 5 * 60 * 1000;

function isConfigured() {
  return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

function headers() {
  return {
    'x-client-id': process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'x-api-version': API_VERSION(),
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

async function call(method, path, body) {
  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Cashfree request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code || '';
    throw err;
  }
  return data;
}

// Creates an order and returns { payment_session_id, order_status, ... }.
function createOrder({ orderId, amount, currency = 'INR', customerId, phone, email, name, returnUrl, notifyUrl, note }) {
  return call('POST', '/orders', {
    order_id: orderId,
    order_amount: Number(amount).toFixed(2),
    order_currency: currency,
    customer_details: {
      customer_id: String(customerId).slice(0, 50),
      customer_phone: String(phone),
      customer_email: email || undefined,
      customer_name: name ? String(name).slice(0, 100) : undefined
    },
    order_meta: { return_url: returnUrl, notify_url: notifyUrl },
    order_note: note ? String(note).slice(0, 180) : undefined
  });
}

// Authoritative status check. Never trust the browser or the webhook body alone.
function fetchOrder(orderId) {
  return call('GET', `/orders/${encodeURIComponent(orderId)}`);
}

// Webhook signature: base64(HMAC-SHA256(timestamp + rawBody, secretKey)).
function computeSignature(timestamp, rawBody, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(timestamp) + String(rawBody)).digest('base64');
}

function verifyWebhook(rawBody, timestamp, signature, now = Date.now()) {
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret || !rawBody || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Accept epoch seconds or milliseconds; reject anything older than 5 minutes (replay protection).
  const tsMs = ts < 1e12 ? ts * 1000 : ts;
  if (Math.abs(now - tsMs) > MAX_WEBHOOK_AGE_MS) return false;
  const expected = Buffer.from(computeSignature(timestamp, rawBody, secret));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// Amount and currency must match what we stored, to the paisa.
function amountMatches(order, fetched) {
  const expectedPaise = Math.round(Number(order.amount) * 100);
  const gotPaise = Math.round(Number(fetched.order_amount) * 100);
  return expectedPaise === gotPaise && String(fetched.order_currency || 'INR').toUpperCase() === 'INR';
}

module.exports = { isConfigured, createOrder, fetchOrder, verifyWebhook, computeSignature, amountMatches, ENV };
