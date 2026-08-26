/* ═══════════════════════════════════════════════════════════
   POST /.netlify/functions/save-reservation
   ─────────────────────────────────────────────────────────
   Body: { guest_name, guest_email, guest_phone, arrival_date,
           departure_date, guests_count, extras, special_requests,
           discount_code, base_price, extras_price, total_price,
           language }
   - Validates required fields
   - Re-checks the dates aren't blocked (never trust the client —
     the calendar the guest saw could be stale)
   - Re-validates the discount code server-side if one was applied
   - Inserts a 'pending' reservation (nothing is confirmed / no
     dates are blocked yet — that only happens once Stripe actually
     confirms the payment, via stripe-webhook.js)
   Returns: { reservation_id }
══════════════════════════════════════════════════════════════ */
const { getSupabaseAdmin, json, handlePreflight, rangesOverlap } = require('./_utils');

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

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

  const {
    guest_name, guest_email, guest_phone,
    arrival_date, departure_date, guests_count,
    extras, special_requests, discount_code,
    base_price, extras_price, total_price, language,
  } = body;

  /* ── Validation ── */
  const errors = [];
  if (!guest_name || !guest_name.trim())        errors.push('guest_name is required');
  if (!isValidEmail(guest_email))                errors.push('guest_email is invalid');
  if (!arrival_date || !departure_date)          errors.push('arrival_date and departure_date are required');
  if (arrival_date >= departure_date)            errors.push('departure_date must be after arrival_date');
  if (!guests_count || guests_count < 1)         errors.push('guests_count must be at least 1');
  if (typeof total_price !== 'number' || total_price <= 0) errors.push('total_price must be a positive number');
  if (errors.length) {
    return json(400, { error: 'Validation failed', details: errors });
  }

  const supabase = getSupabaseAdmin();

  try {
    /* ── Re-check availability server-side ── */
    const { data: blocks, error: blockError } = await supabase
      .from('blocked_dates')
      .select('from_date, until_date')
      .lte('from_date', departure_date)
      .gte('until_date', arrival_date);

    if (blockError) throw blockError;

    const isBlocked = (blocks || []).some((b) =>
      rangesOverlap(arrival_date, departure_date, b.from_date, b.until_date)
    );
    if (isBlocked) {
      return json(409, { error: 'Selected dates are no longer available' });
    }

    /* ── Re-validate discount code server-side ── */
    let finalTotal = total_price;
    if (discount_code) {
      const { data: code } = await supabase
        .from('discount_codes')
        .select('*')
        .ilike('code', discount_code)
        .eq('is_active', true)
        .maybeSingle();

      const today = new Date().toISOString().split('T')[0];
      const codeIsValid = code
        && code.valid_from <= today && today <= code.valid_until
        && code.current_uses < code.max_uses;

      if (!codeIsValid) {
        return json(400, { error: 'Discount code is no longer valid' });
      }

      const discount = code.discount_type === 'percentage'
        ? base_price * (code.discount_value / 100)
        : code.discount_value;
      finalTotal = Math.max(0, base_price + (extras_price || 0) - discount);
    }

    /* ── Insert the reservation (status stays 'pending' until paid) ── */
    const { data: reservation, error: insertError } = await supabase
      .from('reservations')
      .insert({
        guest_name: guest_name.trim(),
        guest_email: guest_email.trim(),
        guest_phone: guest_phone || null,
        arrival_date,
        departure_date,
        nights: Math.round((new Date(departure_date) - new Date(arrival_date)) / 86400000),
        guests_count,
        extras: extras || [],
        special_requests: special_requests || null,
        discount_code: discount_code || null,
        base_price,
        extras_price: extras_price || 0,
        total_price: finalTotal,
        stripe_payment_status: 'pending',
        status: 'pending',
        language: language || 'es',
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    return json(200, { reservation_id: reservation.id, total_price: finalTotal });
  } catch (err) {
    console.error('save-reservation error:', err);
    return json(500, { error: 'Could not save reservation', details: err.message });
  }
};
