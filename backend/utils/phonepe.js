/**
 * PhonePe Payment Gateway v2 (OAuth + Standard Checkout).
 * Never expose client secret or access token to the browser.
 */
const crypto = require('crypto');

const ENV = () => String(process.env.PHONEPE_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
const BASE = () => ENV() === 'production'
  ? 'https://api.phonepe.com/apis/pg'
  : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

function isConfigured() {
  return Boolean(
    process.env.PHONEPE_CLIENT_ID &&
    process.env.PHONEPE_CLIENT_SECRET &&
    process.env.PHONEPE_CLIENT_VERSION
  );
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE()}${path}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15000),
    redirect: 'error'
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) {
    throw new Error(`PhonePe returned a non-JSON response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const e = new Error(String(data.message || data.code || `PhonePe request failed (${response.status})`).slice(0, 300));
    e.status = response.status;
    throw e;
  }
  return data;
}

async function accessToken() {
  const form = new URLSearchParams({
    client_id: process.env.PHONEPE_CLIENT_ID,
    client_version: String(process.env.PHONEPE_CLIENT_VERSION),
    client_secret: process.env.PHONEPE_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });
  const response = await fetch(`${BASE()}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
    signal: AbortSignal.timeout(15000),
    redirect: 'error'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const e = new Error(String(data.message || data.error || `PhonePe OAuth failed (${response.status})`).slice(0, 300));
    e.status = response.status;
    throw e;
  }
  return data.access_token;
}

async function createPayment({ orderId, amountPaise, redirectUrl, expireAfter = 1200 }) {
  const token = await accessToken();
  const data = await request('/checkout/v2/pay', {
    method: 'POST',
    headers: { Authorization: `O-Bearer ${token}`, 'Content-Type': 'application/json' },
    body: {
      merchantOrderId: String(orderId),
      amount: Number(amountPaise),
      expireAfter,
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: 'PresetHub secure payment',
        merchantUrls: { redirectUrl }
      }
    }
  });
  const redirect = data.redirectUrl || data.redirect_url;
  if (!redirect || !/^https:\/\//i.test(redirect)) throw new Error('PhonePe did not return a valid checkout URL.');
  return { ...data, redirectUrl: redirect };
}

async function fetchOrder(orderId) {
  const token = await accessToken();
  return request(`/checkout/v2/order/${encodeURIComponent(orderId)}/status`, {
    headers: { Authorization: `O-Bearer ${token}` }
  });
}

function verifyWebhook(req) {
  const username = String(process.env.PHONEPE_WEBHOOK_USERNAME || '');
  const password = String(process.env.PHONEPE_WEBHOOK_PASSWORD || '');
  const auth = String(req.headers.authorization || '');
  if (!username || !password || !auth.startsWith('Basic ')) return false;
  const expected = Buffer.from(`${username}:${password}`).toString('base64');
  const actual = auth.slice(6).trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function amountMatches(order, payload) {
  const amount = Number(payload.amount);
  return Number.isSafeInteger(amount) &&
    amount === Math.round(Number(order.amount) * 100) &&
    String(payload.currency || 'INR').toUpperCase() === 'INR';
}

module.exports = { ENV, isConfigured, createPayment, fetchOrder, verifyWebhook, amountMatches };
