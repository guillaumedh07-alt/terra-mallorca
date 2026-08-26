/* ═══════════════════════════════════════════════════════════
   POST /.netlify/functions/create-payment-intent
   ─────────────────────────────────────────────────────────
   Body: { amount, reservation_id, guest_email, description }
     amount is in EUROS (major unit) — this function converts to
     cents for Stripe, so the frontend never has to think about it.
   Returns: { client_secret }
══════════════════════════════════════════════════════════════ */
const { getStripe, json, handlePreflight } = require('./_utils');

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { amount, reservation_id, guest_email, description } = body;

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return json(400, { error: 'amount (number, in euros, > 0) is required' });
  }
  if (!reservation_id) {
    return json(400, { error: 'reservation_id is required' });
  }

  try {
    const stripe = getStripe();

    const paymentIntent = await stripe.paymentIntents.create({
      // Stripe wants the smallest currency unit (cents for EUR)
      amount: Math.round(amount * 100),
      currency: 'eur',
      receipt_email: guest_email || undefined,
      description: description || `TERRA reservation ${reservation_id}`,
      metadata: { reservation_id },
      automatic_payment_methods: { enabled: true },
    });

    return json(200, { client_secret: paymentIntent.client_secret });
  } catch (err) {
    console.error('create-payment-intent error:', err);
    return json(500, { error: 'Could not create payment intent', details: err.message });
  }
};
