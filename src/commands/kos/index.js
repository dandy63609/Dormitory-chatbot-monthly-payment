'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const electricityService = require('../../services/electricityService');

const DEFAULT_ELECTRICITY_NOMINAL = 55000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_PROOF_TTL_MS = 24 * 60 * 60 * 1000;

const pendingAdminMarkPaid = {};
const pendingTenantPayments = {};
const pendingProofVerifications = {};

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

function getTenantMasName(tenant) {
  return `Mas ${getTenantName(tenant)}`;
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

function normalizeWhatsAppNumber(value) {
  return String(value || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/[^\d]/g, '');
}

function toWhatsAppJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;

  const normalized = normalizeWhatsAppNumber(raw);
  return normalized ? `${normalized}@s.whatsapp.net` : '';
}

function normalizeProofCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  return raw.startsWith('BUKTI-') ? raw : `BUKTI-${raw}`;
}

function generateProofCode() {
  for (let i = 0; i < 10; i += 1) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const code = `BUKTI-${suffix}`;
    if (!pendingProofVerifications[code]) return code;
  }

  return `BUKTI-${Date.now().toString().slice(-4)}`;
}

function getProofMedia(msg) {
  const imageMessage = msg?.message?.imageMessage;
  if (imageMessage) {
    return {
      kind: 'image',
      mimetype: imageMessage.mimetype || 'image/jpeg',
      fileName: `bukti-${Date.now()}.jpg`,
    };
  }

  const documentMessage = msg?.message?.documentMessage;
  if (documentMessage) {
    return {
      kind: 'document',
      mimetype: documentMessage.mimetype || 'application/octet-stream',
      fileName: documentMessage.fileName || `bukti-${Date.now()}`,
    };
  }

  return null;
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
    `> *Sugeng rawuh, ${getTenantMasName(tenant)}!* 🏠`,
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
      `Nggih, ${getTenantMasName(tenant)}.`,
      `Kamar: *${getTenantRoomCode(tenant)}*`,
      'Tagihan listrik bulan ini belum tersedia.',
    ]);
  }

  return fmt([
    `> *STATUS BAYAR LISTRIK ${String(bulan).toUpperCase()} ${tahun}*`,
    '',
    `Nggih, ${getTenantMasName(tenant)}.`,
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
      `Nggih, ${getTenantMasName(tenant)}.`,
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
    `Nggih, ${getTenantMasName(tenant)}.`,
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

  return `Nggih, ${getTenantMasName(pending.tenant)}. Nek bayar cash, tulung taruh uang listrik ${formatRupiah(getNominal())} nang tempat biasa, yaitu di atas kulkas. Sawise ditaruh, foto uangnya ya. Kirim fotone neng chat iki, nanti tak teruske ke admin.`;
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
    `Nggih, ${getTenantMasName(pending.tenant)}.`,
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

function buildAdminProofCaption(code, pending) {
  return fmt([
    '> *BUKTI PEMBAYARAN LISTRIK*',
    '',
    `Kode: *${code}*`,
    `Penghuni: *${getTenantMasName(pending.tenant)}*`,
    `Kamar: *${getTenantRoomCode(pending.tenant)}*`,
    `Gedung: *${getTenantBuildingName(pending.tenant)}*`,
    `Periode: *${pending.bulan} ${pending.tahun}*`,
    `Metode: *${String(pending.method).toUpperCase()}*`,
    `Nominal: *${formatRupiah(getNominal())}*`,
    '',
    'Balas:',
    `/terima_bukti ${code}`,
    'atau',
    `/tolak_bukti ${code} <alasan>`,
  ]);
}

async function notifyTenant(sock, tenantJid, text) {
  if (!sock || !tenantJid || !text) return false;

  try {
    await sock.sendMessage(tenantJid, { text });
    return true;
  } catch (error) {
    console.error('Gagal mengirim notifikasi Martinos ke penghuni:', error);
    return false;
  }
}

async function handleTerimaBukti(args, sock) {
  const code = normalizeProofCode(args[0]);
  if (!code || !args[0]) {
    return 'Format: `/terima_bukti <kode>`\nContoh: `/terima_bukti BUKTI-1234`';
  }

  const pending = pendingProofVerifications[code];
  if (!pending) {
    return `Kode bukti *${code}* tidak ditemukan atau sudah kedaluwarsa.`;
  }

  try {
    const updated = await electricityService.markElectricityPaidByTagihanId(
      pending.billId,
      pending.method,
    );

    clearPending(pendingProofVerifications, code);

    const tenantReply = fmt([
      '> *Pembayaran listrik diterima*',
      '',
      `Nggih, ${getTenantMasName(pending.tenant)}.`,
      `Bukti pembayaran listrik periode *${pending.bulan} ${pending.tahun}* wis diterima admin.`,
      `Status tagihan kamar *${getTenantRoomCode(pending.tenant)}* sudah *LUNAS*.`,
    ]);
    const notified = await notifyTenant(sock, pending.tenantJid, tenantReply);

    return fmt([
      '> *Bukti pembayaran diterima*',
      '',
      `Kode: *${code}*`,
      `Kamar: *${getTenantRoomCode(pending.tenant)}*`,
      `Penghuni: *${getTenantMasName(pending.tenant)}*`,
      `Periode: *${pending.bulan} ${pending.tahun}*`,
      `Metode: *${String(updated.metode_bayar || pending.method).toUpperCase()}*`,
      notified ? 'Penghuni wis dikabari.' : 'Status sudah lunas, tapi notifikasi penghuni gagal dikirim.',
    ]);
  } catch (error) {
    return `Gagal menerima bukti ${code}: ${error.message}`;
  }
}

async function handleTolakBukti(args, sock) {
  const code = normalizeProofCode(args[0]);
  const reason = args.slice(1).join(' ').trim();

  if (!code || !args[0] || !reason) {
    return 'Format: `/tolak_bukti <kode> <alasan>`\nContoh: `/tolak_bukti BUKTI-1234 nominal belum sesuai`';
  }

  const pending = pendingProofVerifications[code];
  if (!pending) {
    return `Kode bukti *${code}* tidak ditemukan atau sudah kedaluwarsa.`;
  }

  clearPending(pendingProofVerifications, code);

  const tenantReply = fmt([
    '> *Bukti pembayaran perlu dicek maneh*',
    '',
    `Nggih, ${getTenantMasName(pending.tenant)}.`,
    `Bukti pembayaran listrik periode *${pending.bulan} ${pending.tahun}* durung iso diterima.`,
    `Alasan: *${reason}*`,
    '',
    'Tulung kirim ulang lewat */bayar_listrik* ya.',
  ]);
  const notified = await notifyTenant(sock, pending.tenantJid, tenantReply);

  return fmt([
    '> *Bukti pembayaran ditolak*',
    '',
    `Kode: *${code}*`,
    `Kamar: *${getTenantRoomCode(pending.tenant)}*`,
    `Penghuni: *${getTenantMasName(pending.tenant)}*`,
    `Alasan: *${reason}*`,
    notified ? 'Penghuni wis dikabari.' : 'Bukti ditolak, tapi notifikasi penghuni gagal dikirim.',
  ]);
}

async function handleKosCommand(command, args, userId, role, tenant, sock, msg) {
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
      case '/terima_bukti':
        return handleTerimaBukti(args, sock);
      case '/tolak_bukti':
        return handleTolakBukti(args, sock);
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
      case '/terima_bukti':
      case '/tolak_bukti':
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

async function handleProofUpload(msg, userId, tenant, sock) {
  const pending = pendingTenantPayments[userId];
  if (!pending || !pending.method) {
    return false;
  }

  const media = getProofMedia(msg);
  if (!media) {
    return false;
  }

  const adminJid = toWhatsAppJid(process.env.MARTINOS_ADMIN_WA_JID);
  const tenantChatJid = toWhatsAppJid(userId) || msg?.key?.remoteJid;
  const replyJid = msg?.key?.remoteJid || tenantChatJid;

  if (!adminJid) {
    await sock.sendMessage(replyJid, {
      text: fmt([
        `Ngapunten, ${getTenantMasName(tenant || pending.tenant)}.`,
        'Bukti pembayaran belum bisa diteruske karena nomor admin belum disetel.',
        'Hubungi ibu kos dulu ya.',
      ]),
    }, { quoted: msg });
    return true;
  }

  let buffer;
  try {
    buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { reuploadRequest: sock.updateMediaMessage },
    );
  } catch (error) {
    console.error('Gagal download bukti pembayaran Martinos:', error);
    await sock.sendMessage(replyJid, {
      text: `Ngapunten, ${getTenantMasName(tenant || pending.tenant)}. Bukti pembayaran gagal diproses. Coba kirim ulang fotone ya.`,
    }, { quoted: msg });
    return true;
  }

  const code = generateProofCode();
  const verification = {
    ...pending,
    tenant: tenant || pending.tenant,
    tenantJid: tenantChatJid,
    code,
  };

  setPending(pendingProofVerifications, code, verification, PENDING_PROOF_TTL_MS);

  const caption = buildAdminProofCaption(code, verification);
  const adminMessage = media.kind === 'image'
    ? {
      image: buffer,
      mimetype: media.mimetype,
      caption,
    }
    : {
      document: buffer,
      mimetype: media.mimetype,
      fileName: media.fileName,
      caption,
    };

  try {
    await sock.sendMessage(adminJid, adminMessage);
  } catch (error) {
    clearPending(pendingProofVerifications, code);
    console.error('Gagal meneruskan bukti pembayaran Martinos ke admin:', error);
    await sock.sendMessage(replyJid, {
      text: `Ngapunten, ${getTenantMasName(tenant || pending.tenant)}. Bukti pembayaran belum bisa diteruske ke admin. Coba maneh beberapa saat ya.`,
    }, { quoted: msg });
    return true;
  }

  clearPending(pendingTenantPayments, userId);

  await sock.sendMessage(replyJid, {
    text: fmt([
      `Nggih, ${getTenantMasName(tenant || pending.tenant)}.`,
      'Bukti pembayaran wis tak teruske ke admin.',
      `Kode bukti: *${code}*`,
      'Nanti nek wis dicek, panjenengan bakal tak kabari neng chat iki.',
    ]),
  }, { quoted: msg });

  return true;
}

module.exports = {
  handleKosCommand,
  handleProofUpload,
  handlePendingConfirmation,
};
