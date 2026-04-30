const supabase = require('../lib/supabaseClient');
const { isAdmin } = require('../utils/auth');

const KAMAR_TABLE = 'kamar';
const OCCUPIED_STATUS = 'Terisi';

/**
 * Normalizes a WhatsApp JID or Indonesian phone number to a canonical
 * digits-only 62-prefixed phone number.
 *
 * Examples:
 * - 08123456789 -> 628123456789
 * - 628123456789@s.whatsapp.net -> 628123456789
 * - 8123456789 -> 628123456789
 *
 * @param {string} rawUserId - WhatsApp JID or raw phone value.
 * @returns {string} canonical phone number, or empty string if unavailable.
 */
function normalizePhone(rawUserId) {
  const digits = String(rawUserId || '')
    .trim()
    .split('@')[0]
    .split(':')[0]
    .replace(/[^\d]/g, '');

  if (!digits) return '';

  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }

  if (digits.startsWith('8')) {
    return `62${digits}`;
  }

  return digits;
}

function mapKamarToTenant(row) {
  if (!row) return null;

  const building = row.gedung || null;

  return {
    id: row.id,
    name: row.nama_penyewa,
    whatsapp_number: row.hp_penyewa,

    kamar_id: row.id,
    gedung_id: row.gedung_id,
    nomor_kamar: row.nomor_kamar,
    nama_penyewa: row.nama_penyewa,
    hp_penyewa: row.hp_penyewa,
    status_kamar: row.status_kamar,
    gedung: building,

    rooms: {
      id: row.id,
      code: row.nomor_kamar,
      buildings: {
        id: building?.id || row.gedung_id,
        name: building?.nama || null,
      },
    },
  };
}

/**
 * Looks up an occupied Martinos room/tenant by WhatsApp number.
 * Only selects non-sensitive fields from kamar and gedung.
 *
 * @param {string} phone - raw WhatsApp JID or phone number.
 * @returns {Promise<Object|null>} mapped tenant record, or null if not found.
 */
async function getTenantByWhatsAppNumber(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  try {
    const { data, error } = await supabase
      .from(KAMAR_TABLE)
      .select(`
        id,
        gedung_id,
        nomor_kamar,
        nama_penyewa,
        hp_penyewa,
        status_kamar,
        gedung:gedung_id (
          id,
          nama
        )
      `)
      .eq('status_kamar', OCCUPIED_STATUS)
      .not('hp_penyewa', 'is', null);

    if (error) {
      console.error('Error querying tenant by WhatsApp number:', error);
      return null;
    }

    const matched = (data || []).find(
      (row) => normalizePhone(row.hp_penyewa) === normalized,
    );

    return mapKamarToTenant(matched);
  } catch (err) {
    console.error('Unexpected error in getTenantByWhatsAppNumber:', err);
    return null;
  }
}

/**
 * Resolves the role of a WhatsApp sender.
 * Possible roles: 'admin', 'tenant', 'unknown'.
 *
 * @param {string} userId - WhatsApp JID of the message sender.
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
  normalizePhone,
};
