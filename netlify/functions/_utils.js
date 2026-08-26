/* ═══════════════════════════════════════════════════════════
   Shared helpers for the TERRA Netlify Functions.
   Filename starts with "_" so Netlify does NOT expose it as its
   own endpoint — it's only ever require()'d by the other functions.
══════════════════════════════════════════════════════════════ */
const { createClient } = require('@supabase/supabase-js');

/* Server-side Supabase client — uses the SECRET (service_role) key,
   which bypasses Row Level Security. This must only ever run here,
   never in frontend code. Reads both env var names so it works
   whichever one you actually name it in Netlify. */
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable');
  }
  return createClient(url, key);
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY environment variable');
  }
  // eslint-disable-next-line global-require
  return require('stripe')(key);
}

/* CORS headers reused on every response — netlify.toml already sets
   these for the /netlify/functions/* path, but browsers also need
   them on the actual response (not just via the [[headers]] block)
   for preflight (OPTIONS) requests, so we set them here too. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'https://graceful-cajeta-ed800b.netlify.app',
  'Access-Control-Allow-Headers': 'Content-Type, admin_password',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/* Handles the CORS preflight OPTIONS request every browser sends
   before a POST with a JSON body. Call this first in every handler
   and return early if it returns a response. */
function handlePreflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  return null;
}

/* Two date ranges [aFrom, aUntil) and [bFrom, bUntil) overlap unless
   one ends before the other starts. */
function rangesOverlap(aFrom, aUntil, bFrom, bUntil) {
  return aFrom < bUntil && bFrom < aUntil;
}

module.exports = { getSupabaseAdmin, getStripe, json, handlePreflight, rangesOverlap, CORS_HEADERS };
