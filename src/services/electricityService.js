const supabase = require('../lib/supabaseClient');

// ⚠️ CONFIRM: table name may differ
const PERIODS_TABLE = 'electricity_periods';
// ⚠️ CONFIRM: table name may differ
const PAYMENTS_TABLE = 'electricity_payments';
// ⚠️ CONFIRM: table name may differ
const ROOMS_TABLE = 'rooms';

// -------------------------------------------------------------------
// Month utilities
// -------------------------------------------------------------------

/** Capitalised Indonesian month names, 1-indexed (index 0 unused). */
const MONTH_NAMES = [
  null,          // placeholder so index 1 = Januari
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember'
];

/**
 * Lookup table: lowercase alias → month number 1–12.
 * Covers full names, common abbreviations, and alternate spellings.
 */
const MONTH_ALIASES = {
  // January
  jan: 1, januari: 1,
  // February
  feb: 2, februari: 2,
  // March
  mar: 3, maret: 3,
  // April
  apr: 4, april: 4,
  // May
  mei: 5, may: 5,
  // June
  jun: 6, juni: 6,
  // July
  jul: 7, juli: 7,
  // August
  agu: 8, agus: 8, agst: 8, agustus: 8,
  // September
  sep: 9, sept: 9, september: 9,
  // October
  okt: 10, oktober: 10,
  // November
  nov: 11, november: 11,
  // December
  des: 12, desember: 12
};

/**
 * Parses an Indonesian month name or a numeric string to its integer (1–12).
 *
 * @param {string} bulan - e.g. "mei", "Januari", "5"
 * @returns {number|null} integer 1–12, or null if unrecognised
 */
function parseMonthToNumber(bulan) {
  const raw = String(bulan || '').trim().toLowerCase();
  if (!raw) return null;

  // Accept purely numeric strings (e.g. "5", "05", "12")
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    return n >= 1 && n <= 12 ? n : null;
  }

  return MONTH_ALIASES[raw] ?? null;
}

/**
 * Returns the Indonesian month name for a given 1-based month number.
 *
 * @param {number} monthNumber - integer 1–12
 * @returns {string} e.g. "Mei", or the number as a string if out of range
 */
function getMonthName(monthNumber) {
  if (monthNumber >= 1 && monthNumber <= 12) {
    return MONTH_NAMES[monthNumber];
  }
  return String(monthNumber);
}

// -------------------------------------------------------------------
// Internal helper
// -------------------------------------------------------------------

/**
 * Queries electricity_periods for a given month + year combination.
 *
 * @param {number} monthNum - 1–12
 * @param {number} yearNum  - e.g. 2025
 * @returns {Promise<Array>} array of period rows (may be empty)
 * @throws {Error} on Supabase error
 */
async function getPeriodsByMonthYear(monthNum, yearNum) {
  const { data, error } = await supabase
    .from(PERIODS_TABLE)
    .select('id, amount_per_person, building_id') // ⚠️ CONFIRM: column names 'amount_per_person', 'building_id' may differ
    .eq('month', monthNum)  // ⚠️ CONFIRM: column name 'month' may differ
    .eq('year', yearNum);   // ⚠️ CONFIRM: column name 'year' may differ

  if (error) {
    console.error('Error querying electricity_periods:', error);
    throw new Error(`Gagal mengambil data periode listrik: ${error.message}`);
  }

  return data || [];
}

// -------------------------------------------------------------------
// Exported functions
// -------------------------------------------------------------------

/**
 * Returns a summary of electricity payments for the given month/year,
 * broken down by building.
 *
 * @param {string}        bulan - Indonesian month name or number string
 * @param {string|number} tahun - year, e.g. 2025
 * @returns {Promise<{
 *   periodLabel: string,
 *   amountPerPerson?: number,
 *   buildings: Array<{ name: string, total: number, paid: number, unpaid: number }>,
 *   totalTenants: number,
 *   totalPaid: number,
 *   totalUnpaid: number
 * }>}
 */
async function getElectricitySummary(bulan, tahun) {
  const monthNum = parseMonthToNumber(bulan);
  if (!monthNum) {
    throw new Error(
      `Format bulan tidak dikenali: "${bulan}". Gunakan nama bulan Indonesia atau angka 1–12.`
    );
  }

  const yearNum = parseInt(String(tahun || '').trim(), 10);
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    throw new Error(`Format tahun tidak valid: "${tahun}".`);
  }

  const periodLabel = `${getMonthName(monthNum)} ${yearNum}`;
  const periods = await getPeriodsByMonthYear(monthNum, yearNum);

  if (periods.length === 0) {
    return { periodLabel, buildings: [], totalTenants: 0, totalPaid: 0, totalUnpaid: 0 };
  }

  const periodIds = periods.map((p) => p.id);
  // ⚠️ CONFIRM: if amount_per_person differs per building, adjust this aggregation
  const amountPerPerson = periods[0].amount_per_person;

  const { data: payments, error } = await supabase
    .from(PAYMENTS_TABLE)
    .select(`
      is_paid,
      rooms:room_id (
        code,
        buildings:building_id (
          id,
          name,
          code
        )
      )
    `) // ⚠️ CONFIRM: join paths 'room_id', 'building_id' and column names may differ
    .in('period_id', periodIds); // ⚠️ CONFIRM: column name 'period_id' may differ

  if (error) {
    console.error('Error querying electricity_payments for summary:', error);
    throw new Error(`Gagal mengambil data pembayaran listrik: ${error.message}`);
  }

  // Group by building id
  const buildingMap = {};
  for (const payment of payments || []) {
    const building = payment.rooms?.buildings;
    if (!building) continue;

    const key = building.id;
    if (!buildingMap[key]) {
      buildingMap[key] = { name: building.name, total: 0, paid: 0, unpaid: 0 };
    }

    buildingMap[key].total += 1;
    if (payment.is_paid) {
      buildingMap[key].paid += 1;
    } else {
      buildingMap[key].unpaid += 1;
    }
  }

  const buildings  = Object.values(buildingMap);
  const totalTenants = buildings.reduce((sum, b) => sum + b.total,  0);
  const totalPaid    = buildings.reduce((sum, b) => sum + b.paid,   0);
  const totalUnpaid  = buildings.reduce((sum, b) => sum + b.unpaid, 0);

  return { periodLabel, amountPerPerson, buildings, totalTenants, totalPaid, totalUnpaid };
}

/**
 * Returns the list of tenants who have not yet paid electricity for the
 * given month/year.  Personal fields (KTP, phone, address) are intentionally
 * excluded.
 *
 * @param {string}        bulan
 * @param {string|number} tahun
 * @returns {Promise<{
 *   periodLabel: string,
 *   tenants: Array<{ roomCode: string, tenantName: string, buildingName: string }>
 * }>}
 */
async function getUnpaidTenants(bulan, tahun) {
  const monthNum = parseMonthToNumber(bulan);
  if (!monthNum) {
    throw new Error(
      `Format bulan tidak dikenali: "${bulan}". Gunakan nama bulan Indonesia atau angka 1–12.`
    );
  }

  const yearNum = parseInt(String(tahun || '').trim(), 10);
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    throw new Error(`Format tahun tidak valid: "${tahun}".`);
  }

  const periodLabel = `${getMonthName(monthNum)} ${yearNum}`;
  const periods = await getPeriodsByMonthYear(monthNum, yearNum);

  if (periods.length === 0) {
    return { periodLabel, tenants: [] };
  }

  const periodIds = periods.map((p) => p.id);

  const { data: payments, error } = await supabase
    .from(PAYMENTS_TABLE)
    .select(`
      rooms:room_id (
        code,
        buildings:building_id (
          name
        )
      ),
      tenants:tenant_id (
        name
      )
    `) // ⚠️ CONFIRM: join paths may differ — KTP, phone, address intentionally excluded
    .in('period_id', periodIds)  // ⚠️ CONFIRM: column name 'period_id' may differ
    .eq('is_paid', false);       // ⚠️ CONFIRM: column name 'is_paid' may differ

  if (error) {
    console.error('Error querying unpaid electricity_payments:', error);
    throw new Error(`Gagal mengambil data penunggak listrik: ${error.message}`);
  }

  const tenants = (payments || []).map((payment) => ({
    roomCode:     payment.rooms?.code              ?? null,
    tenantName:   payment.tenants?.name            ?? null,
    buildingName: payment.rooms?.buildings?.name   ?? null
  }));

  return { periodLabel, tenants };
}

/**
 * Marks an electricity payment record as paid.
 *
 * @param {string}        roomCode - e.g. "A01"
 * @param {string}        bulan
 * @param {string|number} tahun
 * @param {string}        method   - payment method, e.g. "transfer", "cash"
 * @param {string}        adminId  - WhatsApp JID or identifier of the acting admin
 * @returns {Promise<{ roomCode: string, periodLabel: string, method: string }>}
 */
async function markElectricityPaid(roomCode, bulan, tahun, method, adminId) {
  const monthNum = parseMonthToNumber(bulan);
  if (!monthNum) {
    throw new Error(
      `Format bulan tidak dikenali: "${bulan}". Gunakan nama bulan Indonesia atau angka 1–12.`
    );
  }

  const yearNum = parseInt(String(tahun || '').trim(), 10);
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    throw new Error(`Format tahun tidak valid: "${tahun}".`);
  }

  const periodLabel = `${getMonthName(monthNum)} ${yearNum}`;

  // 1. Resolve room id from code
  const { data: room, error: roomError } = await supabase
    .from(ROOMS_TABLE)
    .select('id, code') // ⚠️ CONFIRM: column names may differ
    .eq('code', roomCode)
    .maybeSingle();

  if (roomError) {
    console.error('Error querying room by code:', roomError);
    throw new Error(`Gagal mencari kamar "${roomCode}": ${roomError.message}`);
  }

  if (!room) {
    throw new Error(`Kamar dengan kode "${roomCode}" tidak ditemukan.`);
  }

  const roomId = room.id;

  // 2. Resolve period ids
  const periods = await getPeriodsByMonthYear(monthNum, yearNum);
  if (periods.length === 0) {
    throw new Error(`Periode listrik ${periodLabel} belum tersedia di sistem.`);
  }

  const periodIds = periods.map((p) => p.id);

  // 3. UPDATE rows that are currently unpaid
  const { data: updated, error: updateError } = await supabase
    .from(PAYMENTS_TABLE)
    .update({
      is_paid:        true,
      paid_at:        new Date().toISOString(), // ⚠️ CONFIRM: column name 'paid_at' may differ
      payment_method: method,                  // ⚠️ CONFIRM: column name 'payment_method' may differ
      marked_by:      adminId                  // ⚠️ CONFIRM: column name 'marked_by' may differ
    })
    .in('period_id', periodIds) // ⚠️ CONFIRM: column name 'period_id' may differ
    .eq('room_id', roomId)      // ⚠️ CONFIRM: column name 'room_id' may differ
    .eq('is_paid', false)
    .select();

  if (updateError) {
    console.error('Error updating electricity payment to paid:', updateError);
    throw new Error(`Gagal memperbarui status pembayaran: ${updateError.message}`);
  }

  if (!updated || updated.length === 0) {
    // Distinguish "already paid" from "record not found"
    const { data: existing, error: checkError } = await supabase
      .from(PAYMENTS_TABLE)
      .select('is_paid')
      .in('period_id', periodIds)
      .eq('room_id', roomId)
      .maybeSingle();

    if (checkError) {
      console.error('Error checking existing payment status:', checkError);
    }

    if (existing && existing.is_paid) {
      throw new Error(`Kamar ${roomCode} sudah lunas untuk periode ${periodLabel}.`);
    }

    throw new Error(
      `Data pembayaran listrik untuk kamar ${roomCode} periode ${periodLabel} tidak ditemukan.`
    );
  }

  return { roomCode, periodLabel, method };
}

/**
 * Returns the electricity payment status for an authenticated tenant for the
 * given month/year.
 *
 * @param {string}        tenantId - tenant UUID from the tenants table
 * @param {string}        bulan
 * @param {string|number} tahun
 * @returns {Promise<{
 *   periodLabel: string,
 *   amountPerPerson: number,
 *   isPaid: boolean,
 *   paidAt: string|null,
 *   paymentMethod: string|null
 * }|null>} payment object, or null if no record exists
 */
async function getOwnElectricityStatus(tenantId, bulan, tahun) {
  const monthNum = parseMonthToNumber(bulan);
  if (!monthNum) {
    throw new Error(
      `Format bulan tidak dikenali: "${bulan}". Gunakan nama bulan Indonesia atau angka 1–12.`
    );
  }

  const yearNum = parseInt(String(tahun || '').trim(), 10);
  if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
    throw new Error(`Format tahun tidak valid: "${tahun}".`);
  }

  const periodLabel = `${getMonthName(monthNum)} ${yearNum}`;
  const periods = await getPeriodsByMonthYear(monthNum, yearNum);

  if (periods.length === 0) {
    return null;
  }

  const periodIds = periods.map((p) => p.id);
  // ⚠️ CONFIRM: may need per-tenant amount resolution if multiple buildings differ
  const amountPerPerson = periods[0].amount_per_person;

  const { data: payment, error } = await supabase
    .from(PAYMENTS_TABLE)
    .select('is_paid, paid_at, payment_method') // ⚠️ CONFIRM: column names may differ
    .in('period_id', periodIds)
    .eq('tenant_id', tenantId) // ⚠️ CONFIRM: column name 'tenant_id' may differ
    .maybeSingle();

  if (error) {
    console.error('Error querying own electricity status:', error);
    throw new Error(`Gagal mengambil status pembayaran listrik: ${error.message}`);
  }

  if (!payment) {
    return null;
  }

  return {
    periodLabel,
    amountPerPerson,
    isPaid:        payment.is_paid,
    paidAt:        payment.paid_at,
    paymentMethod: payment.payment_method
  };
}

module.exports = {
  getElectricitySummary,
  getUnpaidTenants,
  markElectricityPaid,
  getOwnElectricityStatus,
  parseMonthToNumber,
  getMonthName
};
