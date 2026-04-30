'use strict';

const electricityService = require('../../services/electricityService');

const DEFAULT_ELECTRICITY_NOMINAL = 55000;
const PENDING_TTL_MS = 10 * 60 * 1000;

const pendingAdminMarkPaid = {};
const pendingTenantPayments = {};

function setPending(map, key, value, ttlMs = PENDING_TTL_MS) {
  if (map[key]?.timeout) {
    clearTimeout(map[key].timeout);
  }

  const timeout = setTimeout(() => {
    delete map[key];
  }, ttlMs);

  map[key] = { ...value, timeout };
}

function clearPending(map, key) {
  if (map[key]?.timeout) {
    clearTimeout(map[key].timeout);
  }
  delete map[key];
}

function fmt(lines) {
  return lines
    .filter((line) => line !== null && line !== undefined && line !== false)
    .join('\n');
}

function getNominal() {
  const nominal = Number.parseInt(
    process.env.MARTINOS_LISTRIK_NOMINAL || String(DEFAULT_ELECTRICITY_NOMINAL),
    10,
  );

  return Number.isFinite(nominal) && nominal > 0
    ? nominal
    : DEFAULT_ELECTRICITY_NOMINAL;
}

function formatRupiah(value) {
  return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

function getCurrentPeriod() {
  const now = new Date();
  const monthNumber = now.getMonth() + 1;

  return {
    bulan: electricityService.getMonthName(monthNumber),
    bulanNumber: monthNumber,
    tahun: now.getFullYear(),
  };
}

function getTenantRoomId(tenant) {
  return tenant?.kamar_id || tenant?.id || tenant?.rooms?.id || null;
}

function getTenantRoomCode(tenant) {
  return tenant?.nomor_kamar || tenant?.rooms?.code || '-';
}

function getTenantName(tenant) {
  return tenant?.nama_penyewa || tenant?.name || 'Penghuni';
}

function getTenantBuildingName(tenant) {
  return tenant?.gedung?.nama || tenant?.rooms?.buildings?.name || '-';
}

function getTenantBuildingLabel(tenant) {
  const buildingName = getTenantBuildingName(tenant);
  if (!buildingName || buildingName === '-') return 'Martinos Kos';
  if (String(buildingName).toLowerCase().includes('martinos kos')) {
    return buildingName;
  }
  return `Martinos Kos ${buildingName}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('id-ID');
}

function formatBillStatus(bill) {
  const status = String(bill?.status_bayar || 'belum lunas').trim() || 'belum lunas';
  const method = bill?.metode_bayar ? `\nMetode: *${bill.metode_bayar}*` : '';
  const paidAt = bill?.tanggal_bayar ? `\nTanggal bayar: *${formatDate(bill.tanggal_bayar)}*` : '';
  return `Status: *${status.toUpperCase()}*${method}${paidAt}`;
}

function buildKosInfoMenu() {
  return fmt([
    '> *Halo, Bu* 🏠',
    '',
    'Panjenengan terdaftar sebagai admin Martinos Kos.',
    'Aku iso bantu cek listrik lan ngirim pengumuman.',
    '',
    '*Menu Admin:*',
    '- /listrik <bulan> <tahun> : Cek ringkasan pembayaran listrik',
    '- /umumkan <target> <pesan> : Kirim pengumuman ke grup kos',
    '',
    '*Contoh:*',
    '/listrik mei 2026',
    '/umumkan semua Besok air mati jam 10 pagi',
    '',
    'Catatan:',
    'Verifikasi pembayaran ora lewat menu iki.',
    'Nek penghuni kirim bukti dari /bayar_listrik, bot bakal neruske bukti ke admin.',
    'Admin cukup balas:',
    '/terima_bukti <kode>',
    'atau',
    '/tolak_bukti <kode> <alasan>',
  ]);
}

function buildTenantInfoMenu(tenant) {
  return fmt([
    '> *Halo, Mas/Mbak!* 🏠',
    '',
    `Panjenengan terdaftar sebagai penghuni *${getTenantBuildingLabel(tenant)}*.`,
    `Kamar panjenengan: *${getTenantRoomCode(tenant)}*.`,
    '',
    'Ana sing iso tak bantu?',
    'Nek arep bayar listrik, ketik */bayar_listrik*.',
    'Nek arep lihat status pembayaran, ketik */status_bayar_info*.',
    '',
    '*Menu Penghuni:*',
    '- /bayar_listrik : Bayar listrik bulan iki',
    '- /status_bayar_info : Cek status pembayaran listrik',
  ]);
}

async function handleListrik(args) {
  const [bulan, tahun] = args;
  if (!bulan || !tahun) {
    return 'Format: `/listrik <bulan> <tahun>`\nContoh: `/listrik mei 2025`';
  }

  const summary = await electricityService.getElectricitySummary(bulan, tahun);
  const buildingLines = summary.buildings.length > 0
    ? summary.buildings.map((building) => (
      `- *${building.name}*: ${building.paid} lunas, ${building.unpaid} belum (${building.total} total)`
    ))
    : ['Belum ada data tagihan untuk periode ini.'];

  return fmt([
    `> *RINGKASAN LISTRIK ${summary.periodLabel.toUpperCase()}*`,
    '',
    `Nominal: *${formatRupiah(summary.amountPerPerson || getNominal())}*`,
    `Total tagihan: *${summary.totalTenants}*`,
    `Lunas: *${summary.totalPaid}*`,
    `Belum lunas: *${summary.totalUnpaid}*`,
    '',
    '*Per Gedung:*',
    ...buildingLines,
  ]);
}

async function handleBelumListrik(args) {
  const [bulan, tahun] = args;
  if (!bulan || !tahun) {
    return 'Format: `/belum_listrik <bulan> <tahun>`\nContoh: `/belum_listrik mei 2025`';
  }

  const result = await electricityService.getUnpaidTenants(bulan, tahun);
  if (result.tenants.length === 0) {
    return `> *BELUM BAYAR LISTRIK ${result.periodLabel.toUpperCase()}*\n\nSemua tagihan sudah lunas.`;
  }

  const lines = result.tenants.map((tenant, index) => (
    `${index + 1}. *${tenant.nomor_kamar || tenant.roomCode || '-'}* - ${tenant.nama_penyewa || tenant.tenantName || '-'} (${tenant.gedung?.nama || tenant.buildingName || '-'})`
  ));

  return fmt([
    `> *BELUM BAYAR LISTRIK ${result.periodLabel.toUpperCase()}*`,
    '',
    `Total: *${result.tenants.length}* tagihan belum lunas.`,
    '',
    ...lines,
  ]);
}

function handleLunasListrik(args, userId) {
  const [roomCode, bulan, tahun, method] = args;
  if (!roomCode || !bulan || !tahun || !method) {
    return 'Format: `/lunas_listrik <room_code> <bulan> <tahun> <method>`\nContoh: `/lunas_listrik M1-1303 mei 2025 cash`';
  }

  setPending(pendingAdminMarkPaid, userId, { roomCode, bulan, tahun, method });

  return fmt([
    '> *Konfirmasi Pembayaran Listrik*',
    '',
    `Kamar: *${roomCode}*`,
    `Periode: *${bulan} ${tahun}*`,
    `Metode: *${method.toUpperCase()}*`,
    '',
    'Ketik *YA BAYAR* untuk menandai tagihan ini lunas.',
  ]);
}

async function handleAdminMarkPaidConfirmation(userId) {
  const pending = pendingAdminMarkPaid[userId];
  if (!pending) return null;

  const { roomCode, bulan, tahun, method } = pending;

  try {
    const result = await electricityService.markElectricityPaidByRoomCode(
      roomCode,
      bulan,
      tahun,
      method,
    );

    clearPending(pendingAdminMarkPaid, userId);

    return fmt([
      '> *Pembayaran listrik berhasil dicatat lunas*',
      '',
      `Kamar: *${roomCode}*`,
      `Periode: *${result.periodLabel || `${bulan} ${tahun}`}*`,
      `Metode: *${String(method).toUpperCase()}*`,
    ]);
  } catch (error) {
    clearPending(pendingAdminMarkPaid, userId);
    return `Gagal mencatat pembayaran listrik: ${error.message}`;
  }
}

async function handleStatusBayarInfo(tenant) {
  const kamarId = getTenantRoomId(tenant);
  if (!kamarId) {
    return 'Data kamar penghuni tidak ditemukan.';
  }

  const { bulan, tahun } = getCurrentPeriod();
  const bill = await electricityService.getCurrentTenantBill(kamarId, bulan, tahun);

  if (!bill) {
    return fmt([
      `> *STATUS BAYAR LISTRIK ${String(bulan).toUpperCase()} ${tahun}*`,
      '',
      `Kamar: *${getTenantRoomCode(tenant)}*`,
      'Tagihan listrik bulan ini belum tersedia.',
    ]);
  }

  return fmt([
    `> *STATUS BAYAR LISTRIK ${String(bulan).toUpperCase()} ${tahun}*`,
    '',
    `Kamar: *${getTenantRoomCode(tenant)}*`,
    `Periode: *${bulan} ${tahun}*`,
    `Nominal: *${formatRupiah(getNominal())}*`,
    formatBillStatus(bill),
  ]);
}

async function handleBayarListrik(userId, tenant) {
  const kamarId = getTenantRoomId(tenant);
  if (!kamarId) {
    return 'Data kamar penghuni tidak ditemukan.';
  }

  const { bulan, tahun } = getCurrentPeriod();
  const bill = await electricityService.getCurrentTenantBill(kamarId, bulan, tahun);

  if (!bill) {
    return fmt([
      `> *TAGIHAN LISTRIK ${String(bulan).toUpperCase()} ${tahun}*`,
      '',
      `Kamar: *${getTenantRoomCode(tenant)}*`,
      'Tagihan listrik bulan ini belum tersedia. Hubungi ibu kos ya.',
    ]);
  }

  setPending(pendingTenantPayments, userId, {
    tenant,
    kamarId,
    billId: bill.id,
    bulan,
    tahun,
    method: null,
  });

  return fmt([
    `> *BAYAR LISTRIK ${String(bulan).toUpperCase()} ${tahun}*`,
    '',
    `Kamar: *${getTenantRoomCode(tenant)}*`,
    `Nominal: *${formatRupiah(getNominal())}*`,
    formatBillStatus(bill),
    '',
    'Pilih cara bayar dengan membalas:',
    '*CASH* atau *TRANSFER*',
  ]);
}

function handleCashChoice(userId) {
  const pending = pendingTenantPayments[userId];
  if (!pending) return null;

  setPending(pendingTenantPayments, userId, { ...pending, method: 'cash' });

  return `Nggih, Mas/Mbak. Nek bayar cash, tulung taruh uang listrik ${formatRupiah(getNominal())} nang tempat biasa, yaitu di atas kulkas. Sawise ditaruh, foto uangnya ya. Kirim fotone neng chat iki, nanti tak teruske ke admin.`;
}

function handleTransferChoice(userId) {
  const pending = pendingTenantPayments[userId];
  if (!pending) return null;

  setPending(pendingTenantPayments, userId, { ...pending, method: 'transfer' });

  const bankName = process.env.MARTINOS_BANK_NAME || '-';
  const bankAccount = process.env.MARTINOS_BANK_ACCOUNT || '-';
  const bankAccountName = process.env.MARTINOS_BANK_ACCOUNT_NAME || '-';

  return fmt([
    '> *Transfer Listrik Martinos Kos*',
    '',
    `Nominal: *${formatRupiah(getNominal())}*`,
    `Bank: *${bankName}*`,
    `No. Rekening: *${bankAccount}*`,
    `Atas Nama: *${bankAccountName}*`,
    '',
    'Sawise transfer, kirim screenshot/foto bukti pembayaran neng chat iki ya.',
  ]);
}

async function handleTextReply(text, userId, role) {
  const normalized = String(text || '').trim().toUpperCase();

  if (role === 'admin' && normalized === 'YA BAYAR') {
    return handleAdminMarkPaidConfirmation(userId);
  }

  if (role === 'tenant' && normalized === 'CASH') {
    return handleCashChoice(userId);
  }

  if (role === 'tenant' && normalized === 'TRANSFER') {
    return handleTransferChoice(userId);
  }

  return null;
}

async function handleKosCommand(command, args, userId, role, tenant, sock, msg) {
  void sock;
  void msg;

  const normalizedCommand = String(command || '').trim().toLowerCase();

  if (!normalizedCommand.startsWith('/')) {
    return handleTextReply(normalizedCommand, userId, role);
  }

  if (normalizedCommand === '/start') {
    if (role === 'admin') return buildKosInfoMenu();
    if (role === 'tenant') return buildTenantInfoMenu(tenant);
    return null;
  }

  if (normalizedCommand === '/info') {
    if (role === 'admin') return buildKosInfoMenu();
    if (role === 'tenant') return buildTenantInfoMenu(tenant);
    return null;
  }

  if (role === 'admin') {
    switch (normalizedCommand) {
      case '/kos_info':
        return buildKosInfoMenu();
      case '/listrik':
        try {
          return await handleListrik(args);
        } catch (error) {
          return `Gagal mengambil ringkasan listrik: ${error.message}`;
        }
      case '/belum_listrik':
        try {
          return await handleBelumListrik(args);
        } catch (error) {
          return `Gagal mengambil daftar belum bayar: ${error.message}`;
        }
      case '/lunas_listrik':
        return handleLunasListrik(args, userId);
      case '/bayar_listrik':
      case '/status_bayar_info':
        return 'Perintah ini khusus penghuni kos.';
      default:
        return null;
    }
  }

  if (role === 'tenant') {
    switch (normalizedCommand) {
      case '/bayar_listrik':
        try {
          return await handleBayarListrik(userId, tenant);
        } catch (error) {
          return `Gagal mengambil tagihan listrik: ${error.message}`;
        }
      case '/status_bayar_info':
        try {
          return await handleStatusBayarInfo(tenant);
        } catch (error) {
          return `Gagal mengambil status pembayaran: ${error.message}`;
        }
      case '/kos_info':
      case '/listrik':
      case '/belum_listrik':
      case '/lunas_listrik':
        return 'Ngapunten ya, fitur iki khusus admin Martinos Kos.';
      default:
        return null;
    }
  }

  return null;
}

async function handlePendingConfirmation(cleanText, userId, role, sock) {
  void sock;
  return handleTextReply(cleanText, userId, role);
}

async function handleProofUpload() {
  return false;
}

module.exports = {
  handleKosCommand,
  handleProofUpload,
  handlePendingConfirmation,
};
