const supabase = require('../lib/supabaseClient');

const TAGIHAN_TABLE = 'tagihan_listrik';
const KAMAR_TABLE = 'kamar';
const PAID_STATUS = 'Lunas';
const UNPAID_STATUS = 'Belum Bayar';
const OCCUPIED_STATUS = 'Terisi';

/** Values allowed by DB CHECK on tagihan_listrik.metode_bayar */
const METODE_DB_TUNAI = 'Tunai';
const METODE_DB_TRANSFER_BANK = 'Transfer Bank';

/**
 * Map app/internal labels to Supabase tagihan_listrik.metode_bayar CHECK values.
 * @param {unknown} input
 * @returns {'Tunai'|'Transfer Bank'|null}
 */
function normalizeTagihanMetodeBayarForDb(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return null;
  }
  const key = raw.replace(/\s+/g, ' ').toUpperCase();
  if (key === 'TUNAI' || key === 'CASH') {
    return METODE_DB_TUNAI;
  }
  if (key === 'TRANSFER' || key === 'TRANSFER BANK') {
    return METODE_DB_TRANSFER_BANK;
  }
  throw new Error(
    `Metode bayar tidak dikenali: "${raw}". Didukung: Tunai, Transfer Bank, cash, transfer.`,
  );
}

/**
 * Label for admin-facing copy (matches normalized tagihan_listrik.metode_bayar).
 * @param {unknown} input
 * @returns {'Tunai'|'Transfer Bank'}
 */
function formatMetodeBayarForAdminDisplay(input) {
  const label = normalizeTagihanMetodeBayarForDb(input);
  if (!label) {
    throw new Error('Metode pembayaran wajib diisi.');
  }
  return label;
}

const MONTH_NAMES = [
  null,
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
  'Desember',
];

const MONTH_ALIASES = {
  januari: 1,
  februari: 2,
  maret: 3,
  april: 4,
  mei: 5,
  juni: 6,
  juli: 7,
  agustus: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
};

function parseMonth(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) {
    throw new Error('Format bulan tidak valid. Gunakan nama bulan Indonesia atau angka 1-12.');
  }

  if (/^\d+$/.test(raw)) {
    const numericMonth = Number.parseInt(raw, 10);
    if (numericMonth >= 1 && numericMonth <= 12) {
      return numericMonth;
    }
  }

  if (MONTH_ALIASES[raw]) {
    return MONTH_ALIASES[raw];
  }

  throw new Error(`Format bulan tidak dikenali: "${input}". Gunakan januari-desember atau angka 1-12.`);
}

function parseMonthToNumber(input) {
  try {
    return parseMonth(input);
  } catch (_error) {
    return null;
  }
}

function parseYear(input) {
  const year = Number.parseInt(String(input || '').trim(), 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`Format tahun tidak valid: "${input}".`);
  }
  return year;
}

function getMonthName(monthNumber) {
  return MONTH_NAMES[monthNumber] || String(monthNumber);
}

function getPeriodLabel(monthNumber, year) {
  return `${getMonthName(monthNumber)} ${year}`;
}

function isPaid(statusBayar) {
  return String(statusBayar || '').trim().toLowerCase() === PAID_STATUS.toLowerCase();
}

function isBeforePeriod(bill, bulan, tahun) {
  const billYear = Number.parseInt(bill?.tahun, 10);
  const billMonth = Number.parseInt(bill?.bulan, 10);
  const currentYear = parseYear(tahun);
  const currentMonth = parseMonth(bulan);

  if (!Number.isInteger(billYear) || !Number.isInteger(billMonth)) {
    return false;
  }

  return billYear < currentYear || (billYear === currentYear && billMonth < currentMonth);
}

function getNominalAmount() {
  const amount = Number.parseInt(process.env.MARTINOS_LISTRIK_NOMINAL || '55000', 10);
  return Number.isFinite(amount) && amount > 0 ? amount : 55000;
}

function buildPaidUpdate(method) {
  const metode_bayar = normalizeTagihanMetodeBayarForDb(method);
  if (!metode_bayar) {
    throw new Error('Metode pembayaran wajib diisi untuk menandai lunas.');
  }
  return {
    status_bayar: PAID_STATUS,
    metode_bayar,
    tanggal_bayar: new Date().toISOString().slice(0, 10),
  };
}

function mapRoom(row) {
  const gedung = row?.gedung || {};
  return {
    id: row?.id || null,
    nomor_kamar: row?.nomor_kamar || null,
    nama_penyewa: row?.nama_penyewa || null,
    hp_penyewa: row?.hp_penyewa || null,
    gedung: {
      id: gedung.id || row?.gedung_id || null,
      nama: gedung.nama || null,
    },
    roomCode: row?.nomor_kamar || null,
    tenantName: row?.nama_penyewa || null,
    tenantPhone: row?.hp_penyewa || null,
    buildingName: gedung.nama || null,
  };
}

async function getOccupiedRooms() {
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
    .eq('status_kamar', OCCUPIED_STATUS);

  if (error) {
    throw new Error(`Gagal mengambil data penghuni aktif: ${error.message}`);
  }

  return (data || []).map(mapRoom);
}

async function getPaidBillsForPeriod(month, year) {
  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .eq('bulan', month)
    .eq('tahun', year)
    .eq('status_bayar', PAID_STATUS);

  if (error) {
    throw new Error(`Gagal mengambil pembayaran listrik lunas: ${error.message}`);
  }

  return data || [];
}

function keyByKamarId(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (row?.kamar_id) map.set(String(row.kamar_id), row);
  }
  return map;
}

async function getCurrentTenantBill(kamarId, bulan, tahun) {
  if (!kamarId) {
    throw new Error('Kamar ID wajib diisi.');
  }

  const month = parseMonth(bulan);
  const year = parseYear(tahun);

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .eq('kamar_id', kamarId)
    .eq('bulan', month)
    .eq('tahun', year)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal mengambil tagihan listrik penghuni: ${error.message}`);
  }

  return data || null;
}

async function getBillById(tagihanId) {
  if (!tagihanId) {
    throw new Error('Tagihan ID wajib diisi.');
  }

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .eq('id', tagihanId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal mengambil tagihan listrik: ${error.message}`);
  }

  return data || null;
}

async function getOldestUnpaidTenantBill(kamarId) {
  if (!kamarId) {
    throw new Error('Kamar ID wajib diisi.');
  }

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .eq('kamar_id', kamarId)
    .or(`status_bayar.is.null,status_bayar.neq.${PAID_STATUS}`)
    .order('tahun', { ascending: true })
    .order('bulan', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal mengambil tagihan listrik tertua penghuni: ${error.message}`);
  }

  return data || null;
}

async function getElectricitySummary(bulan, tahun) {
  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);

  const [rooms, paidBills] = await Promise.all([
    getOccupiedRooms(),
    getPaidBillsForPeriod(month, year),
  ]);
  const paidByKamarId = keyByKamarId(paidBills);
  const grouped = new Map();

  for (const room of rooms) {
    const key = room.gedung?.id || 'tanpa-gedung';
    const name = room.gedung?.nama || 'Tanpa Gedung';

    if (!grouped.has(key)) {
      grouped.set(key, { id: room.gedung?.id || null, name, nama: name, total: 0, paid: 0, unpaid: 0 });
    }

    const summary = grouped.get(key);
    summary.total += 1;
    if (paidByKamarId.has(String(room.id))) {
      summary.paid += 1;
    } else {
      summary.unpaid += 1;
    }
  }

  const buildings = Array.from(grouped.values());
  const totalTenants = buildings.reduce((sum, building) => sum + building.total, 0);
  const totalPaid = buildings.reduce((sum, building) => sum + building.paid, 0);
  const totalUnpaid = buildings.reduce((sum, building) => sum + building.unpaid, 0);

  return {
    periodLabel,
    amountPerPerson: getNominalAmount(),
    buildings,
    totalTenants,
    totalPaid,
    totalUnpaid,
  };
}

async function getUnpaidTenants(bulan, tahun) {
  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);

  const [rooms, paidBills] = await Promise.all([
    getOccupiedRooms(),
    getPaidBillsForPeriod(month, year),
  ]);
  const paidByKamarId = keyByKamarId(paidBills);
  const tenants = rooms
    .filter((room) => !paidByKamarId.has(String(room.id)))
    .map((room) => ({
      tagihanId: null,
      nomor_kamar: room.nomor_kamar,
      nama_penyewa: room.nama_penyewa,
      gedung: {
        nama: room.gedung?.nama || null,
      },
      roomCode: room.roomCode,
      tenantName: room.tenantName,
      buildingName: room.buildingName,
    }));

  return { periodLabel, tenants };
}

async function getPaidTenants(bulan, tahun) {
  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select(`
      id,
      status_bayar,
      metode_bayar,
      tanggal_bayar,
      kamar:kamar_id (
        id,
        nomor_kamar,
        nama_penyewa,
        gedung:gedung_id (
          id,
          nama
        )
      )
    `)
    .eq('bulan', month)
    .eq('tahun', year)
    .eq('status_bayar', PAID_STATUS);

  if (error) {
    throw new Error(`Gagal mengambil daftar sudah bayar listrik: ${error.message}`);
  }

  const tenants = (data || []).map((bill) => {
    const kamar = bill.kamar || {};
    const gedung = kamar.gedung || {};

    return {
      tagihanId: bill.id,
      nomor_kamar: kamar.nomor_kamar || null,
      nama_penyewa: kamar.nama_penyewa || null,
      gedung: {
        nama: gedung.nama || null,
      },
      roomCode: kamar.nomor_kamar || null,
      tenantName: kamar.nama_penyewa || null,
      buildingName: gedung.nama || null,
      paymentMethod: bill.metode_bayar || null,
      paidAt: bill.tanggal_bayar || null,
    };
  });

  return { periodLabel, tenants };
}

async function getExistingUnpaidTenantsForPeriod(bulan, tahun) {
  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);

  const [rooms, paidBills] = await Promise.all([
    getOccupiedRooms(),
    getPaidBillsForPeriod(month, year),
  ]);
  const paidByKamarId = keyByKamarId(paidBills);
  const tenants = rooms
    .filter((room) => !paidByKamarId.has(String(room.id)))
    .map((room) => ({
      tagihanId: null,
      bulan: month,
      tahun: year,
      periodLabel,
      kamarId: room.id,
      roomCode: room.roomCode,
      tenantName: room.tenantName,
      tenantPhone: room.tenantPhone,
      buildingName: room.buildingName,
      statusBayar: UNPAID_STATUS,
    }));

  return { periodLabel, tenants };
}

async function getElectricityBillByRoomCode(roomCode, bulan, tahun) {
  const normalizedRoomCode = String(roomCode || '').trim();
  if (!normalizedRoomCode) {
    throw new Error('Nomor kamar wajib diisi.');
  }

  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);

  const { data: room, error: roomError } = await supabase
    .from(KAMAR_TABLE)
    .select(`
      id,
      nomor_kamar,
      nama_penyewa,
      gedung:gedung_id (
        id,
        nama
      )
    `)
    .eq('nomor_kamar', normalizedRoomCode)
    .maybeSingle();

  if (roomError) {
    throw new Error(`Gagal mencari kamar "${normalizedRoomCode}": ${roomError.message}`);
  }

  if (!room) {
    throw new Error(`Kamar dengan nomor "${normalizedRoomCode}" tidak ditemukan.`);
  }

  const { data: bill, error: billError } = await supabase
    .from(TAGIHAN_TABLE)
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .eq('kamar_id', room.id)
    .eq('bulan', month)
    .eq('tahun', year)
    .maybeSingle();

  if (billError) {
    throw new Error(`Gagal mencari tagihan listrik kamar ${normalizedRoomCode}: ${billError.message}`);
  }

  if (!bill) {
    throw new Error(`Tagihan listrik kamar ${normalizedRoomCode} periode ${periodLabel} tidak ditemukan.`);
  }

  return {
    bill,
    room,
    roomCode: normalizedRoomCode,
    tenantName: room.nama_penyewa || '-',
    buildingName: room.gedung?.nama || '-',
    periodLabel,
  };
}

async function getRoomByCode(roomCode) {
  const normalizedRoomCode = String(roomCode || '').trim();
  if (!normalizedRoomCode) {
    throw new Error('Nomor kamar wajib diisi.');
  }

  const { data: room, error } = await supabase
    .from(KAMAR_TABLE)
    .select(`
      id,
      nomor_kamar,
      nama_penyewa,
      gedung:gedung_id (
        id,
        nama
      )
    `)
    .eq('nomor_kamar', normalizedRoomCode)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal mencari kamar "${normalizedRoomCode}": ${error.message}`);
  }

  if (!room) {
    throw new Error(`Kamar dengan nomor "${normalizedRoomCode}" tidak ditemukan.`);
  }

  return {
    room,
    roomCode: normalizedRoomCode,
    tenantName: room.nama_penyewa || '-',
    buildingName: room.gedung?.nama || '-',
  };
}

async function markElectricityPaidByTagihanId(tagihanId, method, logContext = {}) {
  if (!tagihanId) {
    throw new Error('Tagihan ID wajib diisi.');
  }

  const inputMethod =
    method == null || String(method).trim() === '' ? null : String(method);
  const updatePayload = buildPaidUpdate(method);

  console.log('[electricityService] tagihan_listrik metode_bayar normalized', {
    code: logContext.code ?? null,
    tagihanId,
    roomCode: logContext.roomCode ?? null,
    inputMethod,
    normalizedMetodeBayar: updatePayload.metode_bayar,
  });

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .update(updatePayload)
    .eq('id', tagihanId)
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal memperbarui status pembayaran listrik: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Tagihan listrik dengan ID "${tagihanId}" tidak ditemukan.`);
  }

  return data;
}

async function markElectricityPaidByRoomCode(roomCode, bulan, tahun, method) {
  const roomLookup = await getRoomByCode(roomCode);
  const result = await markElectricityPaidByKamarId(
    roomLookup.room.id,
    bulan,
    tahun,
    method,
    { roomCode: roomLookup.roomCode },
  );

  return {
    ...result,
    roomCode: roomLookup.roomCode,
    tenantName: roomLookup.tenantName,
    buildingName: roomLookup.buildingName,
  };
}

async function markElectricityPaidByKamarId(kamarId, bulan, tahun, method, logContext = {}) {
  if (!kamarId) {
    throw new Error('Kamar ID wajib diisi.');
  }

  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);
  const existingBill = await getCurrentTenantBill(kamarId, month, year);

  if (existingBill && isPaid(existingBill.status_bayar)) {
    return {
      ...existingBill,
      periodLabel,
      method: existingBill.metode_bayar,
      alreadyPaid: true,
    };
  }

  let updated;
  if (existingBill) {
    updated = await markElectricityPaidByTagihanId(existingBill.id, method, {
      ...logContext,
    });
  } else {
    const updatePayload = buildPaidUpdate(method);
    const { data, error } = await supabase
      .from(TAGIHAN_TABLE)
      .insert({
        kamar_id: kamarId,
        bulan: month,
        tahun: year,
        ...updatePayload,
      })
      .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
      .maybeSingle();

    if (error) {
      throw new Error(`Gagal membuat tagihan listrik lunas: ${error.message}`);
    }

    if (!data) {
      throw new Error('Tagihan listrik lunas gagal dibuat.');
    }

    updated = data;
  }

  return {
    ...updated,
    periodLabel,
    method: updated.metode_bayar,
    created: !existingBill,
  };
}

async function markElectricityPaid(roomCode, bulan, tahun, method) {
  return markElectricityPaidByRoomCode(roomCode, bulan, tahun, method);
}

async function getOwnElectricityStatus(kamarId, bulan, tahun) {
  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const bill = await getCurrentTenantBill(kamarId, month, year);

  return {
    periodLabel: getPeriodLabel(month, year),
    amountPerPerson: getNominalAmount(),
    isPaid: isPaid(bill?.status_bayar),
    paidAt: isPaid(bill?.status_bayar) ? bill.tanggal_bayar : null,
    paymentMethod: isPaid(bill?.status_bayar) ? bill.metode_bayar : null,
    statusBayar: isPaid(bill?.status_bayar) ? PAID_STATUS : UNPAID_STATUS,
    tagihanId: isPaid(bill?.status_bayar) ? bill.id : null,
  };
}

module.exports = {
  parseMonth,
  parseYear,
  isPaid,
  isBeforePeriod,
  getPeriodLabel,
  getBillById,
  getCurrentTenantBill,
  getOldestUnpaidTenantBill,
  getElectricitySummary,
  getPaidTenants,
  getUnpaidTenants,
  getExistingUnpaidTenantsForPeriod,
  getRoomByCode,
  getElectricityBillByRoomCode,
  markElectricityPaidByTagihanId,
  markElectricityPaidByKamarId,
  markElectricityPaidByRoomCode,
  normalizeTagihanMetodeBayarForDb,
  formatMetodeBayarForAdminDisplay,

  markElectricityPaid,
  getOwnElectricityStatus,
  parseMonthToNumber,
  getMonthName,
};
