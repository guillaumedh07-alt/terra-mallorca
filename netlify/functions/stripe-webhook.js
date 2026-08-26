/* ═══════════════════════════════════════════════════════════
   POST /.netlify/functions/stripe-webhook
   ─────────────────────────────────────────────────────────
   Configure this URL as a webhook endpoint in the Stripe dashboard
   (Developers → Webhooks), subscribed to:
     - payment_intent.succeeded
     - payment_intent.payment_failed
   Stripe signs every request — we verify that signature with
   STRIPE_WEBHOOK_SECRET (the "Signing secret" Stripe shows you
   when you create the endpoint) before trusting anything in it.

   On payment_intent.succeeded:
     - reservations.stripe_payment_status -> 'paid'
     - reservations.status                -> 'confirmed'
     - a blocked_dates row is created for the stay
     - a confirmation email is sent via EmailJS's REST API

   On payment_intent.payment_failed:
     - reservations.stripe_payment_status -> 'failed'
══════════════════════════════════════════════════════════════ */
const { getStripe, getSupabaseAdmin, json } = require('./_utils');

/* EmailJS's browser SDK isn't meant for server-side use — this
   calls their public REST API directly instead.
   TODO: in the EmailJS dashboard (Account → Security), enable
   "Allow non-browser requests" — EmailJS blocks server-to-server
   calls by default since they don't come from your registered
   site origin. Without that toggle this call will fail with a
   403, but the reservation itself is still confirmed either way
   (this failure is caught and logged, not thrown). */
async function sendConfirmationEmail(reservation) {
  const serviceId  = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_GUEST;
  const publicKey  = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY; // optional, needed if strict mode stays on

  if (!serviceId || !templateId || !publicKey) {
    console.warn('EmailJS env vars not configured — skipping confirmation email');
    return;
  }

  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey || undefined,
      template_params: {
        to_email: reservation.guest_email,
        guest_name: reservation.guest_name,
        arrival_date: reservation.arrival_date,
        departure_date: reservation.departure_date,
        total_price: reservation.total_price,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EmailJS REST API responded ${res.status}: ${text}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET environment variable');
    return json(500, { error: 'Webhook not configured' });
  }

  // Stripe signs the *raw* body — Netlify may hand it to us base64-encoded.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64')
    : event.body;

  let stripeEvent;
  try {
    const stripe = getStripe();
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return json(400, { error: `Webhook signature verification failed: ${err.message}` });
  }

  const supabase = getSupabaseAdmin();

  try {
    if (stripeEvent.type === 'payment_intent.succeeded') {
      const pi = stripeEvent.data.object;
      const reservationId = pi.metadata && pi.metadata.reservation_id;
      if (!reservationId) {
        console.warn('payment_intent.succeeded with no reservation_id in metadata:', pi.id);
        return json(200, { received: true });
      }

      const { data: reservation, error: updateError } = await supabase
        .from('reservations')
        .update({ stripe_payment_status: 'paid', status: 'confirmed' })
        .eq('id', reservationId)
        .select()
        .single();

      if (updateError) throw updateError;

      const { error: blockError } = await supabase.from('blocked_dates').insert({
        from_date: reservation.arrival_date,
        until_date: reservation.departure_date,
        reason: 'reservation',
        guest_name: reservation.guest_name,
        reservation_id: reservation.id,
        created_by: 'system',
      });
      if (blockError) throw blockError;

      try {
        await sendConfirmationEmail(reservation);
      } catch (emailErr) {
        // Don't fail the webhook over email — the reservation is
        // already confirmed and paid, that's what matters most.
        console.error('Confirmation email failed:', emailErr.message);
      }
    }

    if (stripeEvent.type === 'payment_intent.payment_failed') {
      const pi = stripeEvent.data.object;
      const reservationId = pi.metadata && pi.metadata.reservation_id;
      if (reservationId) {
        const { error } = await supabase
          .from('reservations')
          .update({ stripe_payment_status: 'failed' })
          .eq('id', reservationId);
        if (error) throw error;
      }
    }

    return json(200, { received: true });
  } catch (err) {
    console.error('stripe-webhook processing error:', err);
    // Return 500 so Stripe retries the webhook automatically.
    return json(500, { error: 'Webhook processing failed', details: err.message });
  }
};
