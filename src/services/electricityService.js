const supabase = require('../lib/supabaseClient');

const TAGIHAN_TABLE = 'tagihan_listrik';
const KAMAR_TABLE = 'kamar';
const PAID_STATUS = 'lunas';

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
  return String(statusBayar || '').trim().toLowerCase() === PAID_STATUS;
}

function getNominalAmount() {
  const amount = Number.parseInt(process.env.MARTINOS_LISTRIK_NOMINAL || '55000', 10);
  return Number.isFinite(amount) && amount > 0 ? amount : 55000;
}

function buildPaidUpdate(method) {
  return {
    status_bayar: PAID_STATUS,
    metode_bayar: String(method || '').trim() || null,
    tanggal_bayar: new Date().toISOString().slice(0, 10),
  };
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
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal mengambil tagihan listrik penghuni: ${error.message}`);
  }

  return data || null;
}

async function getElectricitySummary(bulan, tahun) {
  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select(`
      id,
      status_bayar,
      kamar:kamar_id (
        id,
        gedung:gedung_id (
          id,
          nama
        )
      )
    `)
    .eq('bulan', month)
    .eq('tahun', year);

  if (error) {
    throw new Error(`Gagal mengambil ringkasan listrik: ${error.message}`);
  }

  const grouped = new Map();

  for (const bill of data || []) {
    const building = bill.kamar?.gedung || {};
    const key = building.id || 'tanpa-gedung';
    const name = building.nama || 'Tanpa Gedung';

    if (!grouped.has(key)) {
      grouped.set(key, { id: building.id || null, name, nama: name, total: 0, paid: 0, unpaid: 0 });
    }

    const summary = grouped.get(key);
    summary.total += 1;
    if (isPaid(bill.status_bayar)) {
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

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select(`
      id,
      status_bayar,
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
    .eq('tahun', year);

  if (error) {
    throw new Error(`Gagal mengambil daftar belum bayar listrik: ${error.message}`);
  }

  const tenants = (data || [])
    .filter((bill) => !isPaid(bill.status_bayar))
    .map((bill) => {
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
      };
    });

  return { periodLabel, tenants };
}

async function markElectricityPaidByTagihanId(tagihanId, method) {
  if (!tagihanId) {
    throw new Error('Tagihan ID wajib diisi.');
  }

  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .update(buildPaidUpdate(method))
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
  const normalizedRoomCode = String(roomCode || '').trim();
  if (!normalizedRoomCode) {
    throw new Error('Nomor kamar wajib diisi.');
  }

  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const periodLabel = getPeriodLabel(month, year);

  const { data: room, error: roomError } = await supabase
    .from(KAMAR_TABLE)
    .select('id, nomor_kamar')
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
    .select('id')
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

  const updated = await markElectricityPaidByTagihanId(bill.id, method);

  return {
    ...updated,
    roomCode: normalizedRoomCode,
    periodLabel,
    method: updated.metode_bayar,
  };
}

async function markElectricityPaid(roomCode, bulan, tahun, method) {
  return markElectricityPaidByRoomCode(roomCode, bulan, tahun, method);
}

async function getOwnElectricityStatus(kamarId, bulan, tahun) {
  const month = parseMonth(bulan);
  const year = parseYear(tahun);
  const bill = await getCurrentTenantBill(kamarId, month, year);

  if (!bill) {
    return null;
  }

  return {
    periodLabel: getPeriodLabel(month, year),
    amountPerPerson: getNominalAmount(),
    isPaid: isPaid(bill.status_bayar),
    paidAt: bill.tanggal_bayar,
    paymentMethod: bill.metode_bayar,
    statusBayar: bill.status_bayar,
    tagihanId: bill.id,
  };
}

module.exports = {
  parseMonth,
  getCurrentTenantBill,
  getElectricitySummary,
  getUnpaidTenants,
  markElectricityPaidByTagihanId,
  markElectricityPaidByRoomCode,

  markElectricityPaid,
  getOwnElectricityStatus,
  parseMonthToNumber,
  getMonthName,
};
