/* ═══════════════════════════════════════════════════════════
   POST /.netlify/functions/sync-admin
   ─────────────────────────────────────────────────────────
   Header: admin_password: <the admin password>
   Body:   { action, ...payload }

   Actions:
     block_dates    { from_date, until_date, reason, guest_name }
     unblock_dates  { id }                        -- blocked_dates.id
     create_code    { code, discount_type, discount_value,
                       valid_from, valid_until, max_uses }
     deactivate_code{ id }                        -- discount_codes.id
     list_reservations {}                         -- for the admin log
                                                       (not in the original
                                                       4 actions, but the
                                                       admin panel's
                                                       reservation log
                                                       needs to read from
                                                       Supabase somehow)
   Returns: { success: true, ... } or { error }
══════════════════════════════════════════════════════════════ */
const { getSupabaseAdmin, json, handlePreflight } = require('./_utils');

exports.handler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  /* ── Auth ──
     TODO: this compares against a single shared ADMIN_PASSWORD env
     var — the same "one password for the whole admin panel" model
     the site already uses client-side. Fine for a single-owner
     staging site; move to real per-user auth (Supabase Auth) before
     handing admin access to more than one person. */
  const providedPassword = event.headers['admin_password'] || event.headers['Admin_Password'];
  const realPassword = process.env.ADMIN_PASSWORD;

  if (!realPassword) {
    console.error('Missing ADMIN_PASSWORD environment variable');
    return json(500, { error: 'Admin auth not configured' });
  }
  if (providedPassword !== realPassword) {
    return json(401, { error: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { action } = body;
  const supabase = getSupabaseAdmin();

  try {
    switch (action) {
      case 'block_dates': {
        const { from_date, until_date, reason, guest_name } = body;
        if (!from_date || !until_date) {
          return json(400, { error: 'from_date and until_date are required' });
        }
        const { data, error } = await supabase
          .from('blocked_dates')
          .insert({
            from_date,
            until_date,
            reason: reason || 'owner_stay',
            guest_name: guest_name || null,
            created_by: 'admin',
          })
          .select()
          .single();
        if (error) throw error;
        return json(200, { success: true, blocked_date: data });
      }

      case 'unblock_dates': {
        const { id } = body;
        if (!id) return json(400, { error: 'id is required' });
        const { error } = await supabase.from('blocked_dates').delete().eq('id', id);
        if (error) throw error;
        return json(200, { success: true });
      }

      case 'create_code': {
        const { code, discount_type, discount_value, valid_from, valid_until, max_uses } = body;
        if (!code || !discount_type || !discount_value || !valid_from || !valid_until) {
          return json(400, { error: 'code, discount_type, discount_value, valid_from and valid_until are required' });
        }
        const { data, error } = await supabase
          .from('discount_codes')
          .insert({
            code: code.trim().toUpperCase(),
            discount_type,
            discount_value,
            valid_from,
            valid_until,
            max_uses: max_uses || 1,
            is_active: true,
          })
          .select()
          .single();
        if (error) throw error;
        return json(200, { success: true, discount_code: data });
      }

      case 'deactivate_code': {
        const { id } = body;
        if (!id) return json(400, { error: 'id is required' });
        const { error } = await supabase
          .from('discount_codes')
          .update({ is_active: false })
          .eq('id', id);
        if (error) throw error;
        return json(200, { success: true });
      }

      case 'list_reservations': {
        const { data, error } = await supabase
          .from('reservations')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        return json(200, { success: true, reservations: data });
      }

      default:
        return json(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('sync-admin error:', err);
    return json(500, { error: 'Admin action failed', details: err.message });
  }
};
