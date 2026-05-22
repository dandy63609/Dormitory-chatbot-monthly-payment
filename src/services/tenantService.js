const supabase = require('../lib/supabaseClient');

const KAMAR_TABLE = 'kamar';
const OCCUPIED_STATUS = 'Terisi';
const warnedRoleConflicts = new Set();

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

function parseAdminNumbers() {
  return String(process.env.ADMIN_WA_NUMBERS || '')
    .split(/[\s,;|]+/)
    .map((item) => normalizePhone(item))
    .filter(Boolean);
}

function normalizeWhatsAppIdentifier(value) {
  return String(value || '')
    .trim()
    .split(':')[0]
    .toLowerCase();
}

function parseAdminJids() {
  return String(process.env.ADMIN_WA_JIDS || '')
    .split(/[\s,;|]+/)
    .map((item) => normalizeWhatsAppIdentifier(item))
    .filter(Boolean);
}

function isAdminPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return parseAdminNumbers().includes(normalized);
}

function isAdminIdentifier(value) {
  if (isAdminPhone(value)) return true;

  const normalized = normalizeWhatsAppIdentifier(value);
  if (!normalized) return false;
  return parseAdminJids().includes(normalized);
}

function isDevelopment() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'development';
}

function isDualRoleTestModeEnabled() {
  return process.env.MARTINOS_TEST_DUAL_ROLE === 'true';
}

function logRoleDebug({ rawJid, normalizedNumber, adminFound, tenantFound, role }) {
  if (!isDevelopment()) return;

  console.log(
    [
      'Martinos role debug:',
      `raw=${rawJid || '-'}`,
      `normalized=${normalizedNumber || '-'}`,
      `isAdmin=${Boolean(adminFound)}`,
      `tenantFound=${Boolean(tenantFound)}`,
      `role=${role || 'unknown'}`,
    ].join(' '),
  );
}

function warnRoleConflictOnce(normalizedNumber) {
  const key = normalizedNumber || 'unknown';
  if (warnedRoleConflicts.has(key)) return;
  warnedRoleConflicts.add(key);
  console.warn('Role conflict: number exists as admin and tenant. Using admin role.');
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
async function resolveRole(userId, options = {}) {
  const normalizedNumber = normalizePhone(userId);
  const rawJid = options.rawJid || userId;

  try {
    const adminFound =
      isAdminIdentifier(userId)
      || isAdminIdentifier(rawJid)
      || isAdminPhone(normalizedNumber);
    const tenant = await getTenantByWhatsAppNumber(normalizedNumber);
    const tenantFound = Boolean(tenant);
    const roleConflict = adminFound && tenantFound;

    let role = 'unknown';
    if (adminFound) role = 'admin';
    else if (tenantFound) role = 'tenant';

    if (roleConflict) {
      warnRoleConflictOnce(normalizedNumber);
    }

    logRoleDebug({
      rawJid,
      normalizedNumber,
      adminFound,
      tenantFound,
      role,
    });

    return {
      role,
      tenant: tenantFound ? tenant : null,
      normalizedNumber,
      isAdmin: adminFound,
      tenantFound,
      roleConflict,
      dualRoleTestMode: isDualRoleTestModeEnabled(),
    };
  } catch (err) {
    console.error('Unexpected error in resolveRole:', err);
    logRoleDebug({
      rawJid,
      normalizedNumber,
      adminFound: isAdminIdentifier(rawJid) || isAdminPhone(normalizedNumber),
      tenantFound: false,
      role: 'unknown',
    });
    return {
      role: 'unknown',
      tenant: null,
      normalizedNumber,
      isAdmin: isAdminIdentifier(rawJid) || isAdminPhone(normalizedNumber),
      tenantFound: false,
      roleConflict: false,
      dualRoleTestMode: isDualRoleTestModeEnabled(),
    };
  }
}

module.exports = {
  resolveRole,
  getTenantByWhatsAppNumber,
  normalizePhone,
  isAdminPhone,
  isAdminIdentifier,
};
