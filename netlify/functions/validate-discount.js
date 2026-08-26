/* ═══════════════════════════════════════════════════════════
   POST /.netlify/functions/validate-discount
   ─────────────────────────────────────────────────────────
   Body: { code, arrival_date, total_price }
   Returns: { valid, discount_type, discount_value, final_price }
   or       { valid: false, reason }
══════════════════════════════════════════════════════════════ */
const { getSupabaseAdmin, json, handlePreflight } = require('./_utils');

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

  const { code, arrival_date, total_price } = body;

  if (!code) {
    return json(400, { error: 'code is required' });
  }
  if (typeof total_price !== 'number' || total_price <= 0) {
    return json(400, { error: 'total_price must be a positive number' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: discountCode, error } = await supabase
      .from('discount_codes')
      .select('*')
      .ilike('code', code)
      .maybeSingle();

    if (error) throw error;

    if (!discountCode || !discountCode.is_active) {
      return json(200, { valid: false, reason: 'invalid' });
    }

    const checkDate = arrival_date || new Date().toISOString().split('T')[0];
    if (checkDate < discountCode.valid_from || checkDate > discountCode.valid_until) {
      return json(200, { valid: false, reason: 'expired' });
    }
    if (discountCode.current_uses >= discountCode.max_uses) {
      return json(200, { valid: false, reason: 'exhausted' });
    }

    const discountAmount = discountCode.discount_type === 'percentage'
      ? total_price * (discountCode.discount_value / 100)
      : discountCode.discount_value;
    const finalPrice = Math.max(0, total_price - discountAmount);

    return json(200, {
      valid: true,
      discount_type: discountCode.discount_type,
      discount_value: discountCode.discount_value,
      final_price: Math.round(finalPrice * 100) / 100,
    });
  } catch (err) {
    console.error('validate-discount error:', err);
    return json(500, { error: 'Could not validate discount code', details: err.message });
  }
};
