/* ═══════════════════════════════════════════════════════════
   GET /.netlify/functions/check-availability?arrival_date=YYYY-MM-DD&departure_date=YYYY-MM-DD
   ─────────────────────────────────────────────────────────
   With both dates: returns whether that exact range is free.
   Without them (or called with no query params): returns every
   blocked range on file, so the frontend calendar can shade out
   unavailable days without one request per month.
   Returns: { available, blocked_dates: [{ from_date, until_date }] }
══════════════════════════════════════════════════════════════ */
const { getSupabaseAdmin, json, handlePreflight, rangesOverlap } = require('./_utils');

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method not allowed' });
  }

  const { arrival_date, departure_date } = event.queryStringParameters || {};

  try {
    const supabase = getSupabaseAdmin();
    const { data: blocks, error } = await supabase
      .from('blocked_dates')
      .select('from_date, until_date, reason')
      .order('from_date', { ascending: true });

    if (error) throw error;

    let available = true;
    if (arrival_date && departure_date) {
      available = !(blocks || []).some((b) =>
        rangesOverlap(arrival_date, departure_date, b.from_date, b.until_date)
      );
    }

    return json(200, { available, blocked_dates: blocks || [] });
  } catch (err) {
    console.error('check-availability error:', err);
    return json(500, { error: 'Could not check availability', details: err.message });
  }
};
