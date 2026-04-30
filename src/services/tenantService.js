const supabase = require('../lib/supabaseClient');
const { isAdmin } = require('../utils/auth');

// ⚠️ CONFIRM: table name may differ
const TENANTS_TABLE = 'tenants';
// ⚠️ CONFIRM: column name may be 'phone', 'no_hp', 'wa_number', 'no_wa'
const WA_NUMBER_COLUMN = 'whatsapp_number';

/**
 * Normalizes a WhatsApp JID to a digits-only phone number string.
 * Handles formats like "628123@s.whatsapp.net" or "628123:3@s.whatsapp.net".
 *
 * @param {string} rawUserId - WhatsApp JID or any raw user identifier
 * @returns {string} digits-only phone number, e.g. "628123"
 */
function normalizePhone(rawUserId) {
  return String(rawUserId || '')
    .split('@')[0]       // strip @s.whatsapp.net (and everything after)
    .split(':')[0]       // strip :X device suffix
    .replace(/[^\d]/g, ''); // strip all remaining non-digit characters
}

/**
 * Looks up an active tenant by their normalized WhatsApp number from Supabase.
 * Only selects non-sensitive fields — never exposes KTP, home address, or parent contacts.
 *
 * @param {string} phone - raw WhatsApp JID or phone number (will be normalized internally)
 * @returns {Promise<Object|null>} tenant row with room and building data, or null on error/not found
 */
async function getTenantByWhatsAppNumber(phone) {
  const normalized = normalizePhone(phone);

  try {
    const { data, error } = await supabase
      .from(TENANTS_TABLE)
      .select(`
        id,
        name,
        ${WA_NUMBER_COLUMN},
        rooms:room_id (
          id,
          code,
          floor,
          buildings:building_id (
            id,
            name,
            code
          )
        )
      `)
      .eq(WA_NUMBER_COLUMN, normalized)
      .eq('is_active', true) // ⚠️ CONFIRM: column name may differ (e.g. 'active', 'status')
      .maybeSingle();

    if (error) {
      console.error('Error querying tenant by WhatsApp number:', error);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('Unexpected error in getTenantByWhatsAppNumber:', err);
    return null;
  }
}

/**
 * Resolves the role of a WhatsApp sender.
 * Possible roles: 'admin', 'tenant', 'unknown'.
 *
 * Never throws — all errors are caught internally.
 *
 * @param {string} userId - WhatsApp JID of the message sender
 * @returns {Promise<{ role: 'admin'|'tenant'|'unknown', tenant: Object|null }>}
 */
async function resolveRole(userId) {
  try {
    if (isAdmin(userId, 'whatsapp')) {
      return { role: 'admin', tenant: null };
    }

    const tenant = await getTenantByWhatsAppNumber(userId);
    if (tenant) {
      return { role: 'tenant', tenant };
    }

    return { role: 'unknown', tenant: null };
  } catch (err) {
    console.error('Unexpected error in resolveRole:', err);
    return { role: 'unknown', tenant: null };
  }
}

module.exports = {
  resolveRole,
  getTenantByWhatsAppNumber,
  normalizePhone
};
