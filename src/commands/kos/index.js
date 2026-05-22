'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const electricityService = require('../../services/electricityService');
const martinosPaymentVerificationService = require('../../services/martinosPaymentVerificationService');
const {
  sendAnnouncement,
  logAnnouncement,
  getAnnouncementTargetSummary,
} = require('../../services/martinosAnnouncementService');
const { normalizePhone } = require('../../services/tenantService');

const DEFAULT_ELECTRICITY_NOMINAL = 55000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TECH_SUPPORT_NUMBER = '08511771087';

const pendingAdminMarkPaid = {};
const pendingTenantPayments = {};
const pendingAnnouncements = {};

function setPending(map, key, value, ttlMs = PENDING_TTL_MS) {
  if (map[key]?.timeout) {
    clearTimeout(map[key].timeout);
  }

  const timeout = setTimeout(() => {
    delete map[key];
  }, ttlMs);

  if (typeof timeout.unref === 'function') {
    timeout.unref();
  }

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

function getTechSupportNumber() {
  return String(process.env.MARTINOS_TECH_SUPPORT_NUMBER || DEFAULT_TECH_SUPPORT_NUMBER).trim();
}

function buildTenantTechnicalIssueReply(tenant, detail) {
  return fmt([
    `Amit nggih, ${getTenantMasName(tenant)}.`,
    detail || 'Bot sedang gangguan/diperbaiki.',
    `Tolong hubungi teknisi di ${getTechSupportNumber()} supaya dicek.`,
  ]);
}

async function safeSendMessage(sock, jid, content, options) {
  try {
    await sock.sendMessage(jid, content, options);
    return true;
  } catch (error) {
    const statusCode = error?.statusCode || error?.output?.statusCode || '-';
    const message = String(error?.message || 'Unknown sendMessage error');
    console.error(`Gagal mengirim pesan WhatsApp Martinos: ${statusCode} ${message}`);
    return false;
  }
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
  if (!buildingName || buildingName === '-') return 'Martinos';
  if (String(buildingName).toLowerCase().includes('martinos')) {
    return buildingName;
  }
  return `Martinos ${buildingName}`;
}

function normalizeWhatsAppNumber(value) {
  return normalizePhone(value);
}

function toWhatsAppJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;

  const normalized = normalizeWhatsAppNumber(raw);
  return normalized ? `${normalized}@s.whatsapp.net` : '';
}

function generateProofCode() {
  for (let i = 0; i < 10; i += 1) {
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    const code = `BUKTI-${suffix}`;
    if (!martinosPaymentVerificationService.isProofCodeInUse(code)) return code;
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
  const status = getElectricityPaymentStatusLabel(bill);
  const method = bill?.metode_bayar ? `\nMetode: *${bill.metode_bayar}*` : '';
  const paidAt = bill?.tanggal_bayar ? `\nTanggal bayar: *${formatDate(bill.tanggal_bayar)}*` : '';
  return `Status: *${status}*${method}${paidAt}`;
}

function formatBillPeriod(bill) {
  return electricityService.getPeriodLabel(bill?.bulan, bill?.tahun);
}

function getPendingAdminAction(userId) {
  if (pendingAnnouncements[userId]) {
    return {
      type: 'announcement',
      label: 'pengumuman',
      confirmText: 'KIRIM PENGUMUMAN',
      cancelText: 'BATAL PENGUMUMAN',
    };
  }

  if (pendingAdminMarkPaid[userId]) {
    return {
      type: 'mark_paid',
      label: 'konfirmasi pembayaran listrik',
      confirmText: 'YA BAYAR',
      cancelText: 'BATAL BAYAR',
    };
  }

  return null;
}

function buildPendingAdminBlockReply(pendingAction) {
  return fmt([
    `Sekedap Bu Umi, wonten *${pendingAction.label}* sing dereng rampung.`,
    `Tulung rampungke rumiyin nganggo *${pendingAction.confirmText}* utawa batalke nganggo *${pendingAction.cancelText}*.`,
    'Sakwise rampung, panjenengan saged nganggo fitur liyane maneh nggih.',
  ]);
}

function formatAnnouncementGroupStatuses(targetSummary) {
  const statuses = targetSummary.groupStatuses || [];
  if (statuses.length === 0) {
    return [];
  }

  return [
    '*Status grup:*',
    ...statuses.map((group) => (
      `- ${group.label}: ${group.configured ? 'siap' : 'belum disetel'}`
    )),
  ];
}

function getElectricityPaymentStatusLabel(bill) {
  if (String(bill?.status_bayar || '').trim().toLowerCase() === 'lunas') {
    return 'Sampun lunas';
  }

  return new Date().getDate() > 5 ? 'Telat bayar' : 'Belum bayar';
}

function buildKosInfoMenu() {
  return fmt([
    '> *Halo, Bu Umi* Ã°Å¸ÂÂ ',
    '',
    'Panjenengan terdaftar sebagai admin Martinos Kos.',
    'Aku iso bantu cek listrik lan ngirim pengumuman.',
    '',
    '*Menu Admin:*',
    '- /listrik <bulan> <tahun> : Cek ringkasan pembayaran listrik',
    '- /sudah_listrik <bulan> <tahun> : Daftar penghuni sing sampun bayar',
    '- /belum_listrik <bulan> <tahun> : Daftar penghuni sing dereng bayar',
    '- /umumkan <target> <pesan> : Kirim pengumuman ke grup kos',
    '- /lunas_listrik <kamar> <bulan> <tahun> <cash|transfer> : Catat manual nek perlu',
    '',
    '*Contoh:*',
    '/listrik mei 2026',
    '/sudah_listrik mei 2026',
    '/belum_listrik mei 2026',
    '/umumkan semua Besok air mati jam 10 pagi',
    '',
    'Catatan:',
    'Verifikasi pembayaran ora lewat menu iki.',
    'Nek penghuni kirim bukti dari /bayar_listrik, bot bakal neruske bukti ke admin.',
    'Admin cukup balas:',
    '/terima_bukti <kode>',
    'atau',
    '/tolak_bukti <kode> <alasan>',
    '',
    'Gunakake /lunas_listrik namung kanggo catatan manual nek memang perlu, Bu Umi.',
  ]);
}

function buildTenantInfoMenu(tenant) {
  return fmt([
    `> *Sugeng rawuh, ${getTenantMasName(tenant)}!* Ã°Å¸ÂÂ `,
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

async function handleUmumkan(args, userId, sock) {
  void sock;
  const target = String(args[0] || '').trim().toLowerCase();
  const message = args.slice(1).join(' ').trim();

  if (!target || !message) {
    return 'Format: `/umumkan <semua|martinos1|martinos2|martinos3> <pesan>`\nContoh: `/umumkan semua Besok air mati jam 10 pagi`';
  }

  const targetSummary = getAnnouncementTargetSummary(target);
  setPending(pendingAnnouncements, userId, { target, message, targetSummary });

  return fmt([
    '> *Konfirmasi Pengumuman Martinos Kos*',
    '',
    `Target: *${targetSummary.label}*`,
    ...formatAnnouncementGroupStatuses(targetSummary),
    `Jumlah grup sing bakal dikirim: *${targetSummary.groupCount}*`,
    '',
    '*Isi pengumuman:*',
    message,
    '',
    'Ketik *KIRIM PENGUMUMAN* untuk mengirim.',
    'Ketik *BATAL PENGUMUMAN* untuk membatalkan.',
  ]);
}

async function handleAnnouncementConfirmation(userId, sock) {
  const pending = pendingAnnouncements[userId];
  if (!pending) return null;

  const { target, message } = pending;
  const targetSummary = pending.targetSummary || getAnnouncementTargetSummary(target);

  try {
    const result = await sendAnnouncement(sock, target, message);
    clearPending(pendingAnnouncements, userId);

    logAnnouncement(target, message, userId).catch((error) => {
      console.warn('Gagal mencatat pengumuman Martinos:', error?.message || error);
    });

    return fmt([
      '> *Pengumuman terkirim*',
      '',
      `Target: *${targetSummary.label}*`,
      `Berhasil: *${result.successCount}/${result.totalCount}* grup`,
    ]);
  } catch (error) {
    clearPending(pendingAnnouncements, userId);
    return `Gagal mengirim pengumuman: ${error.message}`;
  }
}

function handleAnnouncementCancel(userId) {
  const pending = pendingAnnouncements[userId];
  if (!pending) return null;

  clearPending(pendingAnnouncements, userId);
  return 'Pengumuman dibatalkan.';
}

function handleAdminMarkPaidCancel(userId) {
  const pending = pendingAdminMarkPaid[userId];
  if (!pending) return null;

  clearPending(pendingAdminMarkPaid, userId);
  return 'Konfirmasi pembayaran dibatalkan, Bu Umi.';
}

async function handleAdminPendingText(text, userId, role, tenant, sock) {
  const normalized = String(text || '').trim().replace(/^\/+/, '').toUpperCase();

  if (role === 'admin') {
    const pendingAction = getPendingAdminAction(userId);

    if (pendingAction?.type === 'announcement' && normalized === 'KIRIM PENGUMUMAN') {
      return handleAnnouncementConfirmation(userId, sock);
    }

    if (pendingAction?.type === 'announcement' && normalized === 'BATAL PENGUMUMAN') {
      return handleAnnouncementCancel(userId);
    }

    if (pendingAction?.type === 'mark_paid' && normalized === 'YA BAYAR') {
      return handleAdminMarkPaidConfirmation(userId);
    }

    if (pendingAction?.type === 'mark_paid' && normalized === 'BATAL BAYAR') {
      return handleAdminMarkPaidCancel(userId);
    }

    if (pendingAction) {
      return buildPendingAdminBlockReply(pendingAction);
    }
  }

  return handleTextReply(text, userId, role, tenant);
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

async function handleSudahListrik(args) {
  const [bulan, tahun] = args;
  if (!bulan || !tahun) {
    return 'Format: `/sudah_listrik <bulan> <tahun>`\nContoh: `/sudah_listrik mei 2025`';
  }

  const result = await electricityService.getPaidTenants(bulan, tahun);
  if (result.tenants.length === 0) {
    return `> *SUDAH BAYAR LISTRIK ${result.periodLabel.toUpperCase()}*\n\nDereng wonten tagihan sing tercatat lunas.`;
  }

  const lines = result.tenants.map((tenant, index) => {
    const method = tenant.paymentMethod ? ` - ${tenant.paymentMethod}` : '';
    const paidAt = tenant.paidAt ? ` (${formatDate(tenant.paidAt)})` : '';
    return `${index + 1}. *${tenant.nomor_kamar || tenant.roomCode || '-'}* - ${tenant.nama_penyewa || tenant.tenantName || '-'} (${tenant.gedung?.nama || tenant.buildingName || '-'})${method}${paidAt}`;
  });

  return fmt([
    `> *SUDAH BAYAR LISTRIK ${result.periodLabel.toUpperCase()}*`,
    '',
    `Total: *${result.tenants.length}* tagihan sampun lunas.`,
    '',
    ...lines,
  ]);
}

async function handleLunasListrik(args, userId) {
  const [roomCode, bulan, tahun, method] = args;
  if (!roomCode || !bulan || !tahun || !method) {
    return 'Format: `/lunas_listrik <room_code> <bulan> <tahun> <method>`\nContoh: `/lunas_listrik M1-1303 mei 2025 cash`';
  }

  const roomLookup = await electricityService.getRoomByCode(roomCode);
  const month = electricityService.parseMonth(bulan);
  const year = electricityService.parseYear(tahun);
  const periodLabel = electricityService.getPeriodLabel(month, year);
  const bill = await electricityService.getCurrentTenantBill(roomLookup.room.id, month, year);
  const dbMethodLabel = electricityService.formatMetodeBayarForAdminDisplay(method);

  if (bill && electricityService.isPaid(bill.status_bayar)) {
    return fmt([
      '> *Tagihan sudah lunas*',
      '',
      `Kamar: *${roomLookup.roomCode}*`,
      `Penghuni: *${roomLookup.tenantName}*`,
      `Gedung: *${roomLookup.buildingName}*`,
      `Periode: *${periodLabel}*`,
      '',
      'Ora perlu ditandai lunas maneh, Bu Umi.',
    ]);
  }

  setPending(pendingAdminMarkPaid, userId, {
    roomCode: roomLookup.roomCode,
    bulan,
    tahun,
    method: dbMethodLabel,
    tenantName: roomLookup.tenantName,
    buildingName: roomLookup.buildingName,
    periodLabel,
    createsMissingBill: !bill,
  });

  return fmt([
    '> *Konfirmasi Pembayaran Listrik*',
    '',
    `Kamar: *${roomLookup.roomCode}*`,
    `Penghuni: *${roomLookup.tenantName}*`,
    `Gedung: *${roomLookup.buildingName}*`,
    `Periode: *${periodLabel}*`,
    `Metode: *${dbMethodLabel}*`,
    !bill ? 'Catatan: tagihan periode iki durung ana, bot bakal nggawe catatan lunas anyar nek Bu Umi konfirmasi.' : null,
    '',
    'Ketik *YA BAYAR* untuk menandai tagihan ini lunas.',
    'Ketik *BATAL BAYAR* untuk membatalkan.',
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

    if (result.alreadyPaid) {
      return fmt([
        '> *Tagihan sudah lunas*',
        '',
        `Kamar: *${roomCode}*`,
        pending.tenantName ? `Penghuni: *${pending.tenantName}*` : null,
        pending.buildingName ? `Gedung: *${pending.buildingName}*` : null,
        `Periode: *${result.periodLabel || `${bulan} ${tahun}`}*`,
        '',
        'Ora tak ubah maneh nggih Bu Umi, soale tagihan pun sampun lunas.',
      ]);
    }

    return fmt([
      '> *Pembayaran listrik berhasil dicatat lunas*',
      '',
      `Kamar: *${roomCode}*`,
      pending.tenantName ? `Penghuni: *${pending.tenantName}*` : null,
      pending.buildingName ? `Gedung: *${pending.buildingName}*` : null,
      `Periode: *${result.periodLabel || `${bulan} ${tahun}`}*`,
      `Metode: *${result.method || method}*`,
      result.created ? 'Catatan: tagihan durung ana, mula bot nggawe baris tagihan lunas anyar.' : null,
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
  const status = await electricityService.getOwnElectricityStatus(kamarId, bulan, tahun);
  const bill = {
    status_bayar: status.statusBayar,
    metode_bayar: status.paymentMethod,
    tanggal_bayar: status.paidAt,
  };

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

  if (String(bill?.status_bayar || '').trim().toLowerCase() === 'lunas') {
    return fmt([
      `> *BAYAR LISTRIK ${String(bulan).toUpperCase()} ${tahun}*`,
      '',
      `Nggih ${getTenantMasName(tenant)}.`,
      `Kamar: *${getTenantRoomCode(tenant)}*`,
      `Gedung: *${getTenantBuildingLabel(tenant)}*`,
      `Total tagihan: *${formatRupiah(getNominal())}*`,
      formatBillStatus(bill),
      '',
      'Panjenengan sampun mbayar listrik bulan iki nggih.',
      'Ora perlu kirim bukti maneh.',
    ]);
  }

  setPending(pendingTenantPayments, userId, {
    tenant,
    kamarId,
    billId: bill?.id || null,
    bulan,
    tahun,
    method: null,
  });

  return fmt([
    `> *BAYAR LISTRIK ${String(bulan).toUpperCase()} ${tahun}*`,
    '',
    `Nggih ${getTenantMasName(tenant)}`,
    `Kamar: ${getTenantRoomCode(tenant)}`,
    `Gedung: ${getTenantBuildingLabel(tenant)}`,
    `Total tagihan: ${formatRupiah(getNominal())}`,
    `Status: ${getElectricityPaymentStatusLabel(bill)}`,
    '',
    'Metode pembayaran badhe apa, Mas?',
    'Ketik /cash nek bayar tunai.',
    'Ketik /transfer nek bayar transfer.',
  ]);
}

function buildStartPaymentFirstReply(tenant) {
  return fmt([
    `Mas ${getTenantName(tenant)}, sesi pembayaran dereng aktif utawi sampun kedaluwarsa.`,
    'Nek badhe kirim bukti, mulai malih saking */bayar_listrik* rumiyin nggih.',
    'Sakwise kuwi pilih */cash* utawa */transfer*, lajeng kirim bukti pembayaran.',
  ]);
}

function handleCashChoice(userId, tenant) {
  const pending = pendingTenantPayments[userId];
  if (!pending) return buildStartPaymentFirstReply(tenant);

  setPending(pendingTenantPayments, userId, { ...pending, method: 'cash' });

  return `Nggih ${getTenantMasName(pending.tenant)}. Kirim bukti foto uang sampun diletakkan nggih.`;
}

function handleTransferChoice(userId, tenant) {
  const pending = pendingTenantPayments[userId];
  if (!pending) return buildStartPaymentFirstReply(tenant);

  setPending(pendingTenantPayments, userId, { ...pending, method: 'transfer' });

  const bankName = process.env.MARTINOS_BANK_NAME || '-';
  const bankAccount = process.env.MARTINOS_BANK_ACCOUNT || '-';
  const bankAccountName = process.env.MARTINOS_BANK_ACCOUNT_NAME || '-';

  return fmt([
    `Nggih ${getTenantMasName(pending.tenant)}. Berikut rekening pembayaran listrik:`,
    `Bank: ${bankName}`,
    `No Rekening: ${bankAccount}`,
    `Atas Nama: ${bankAccountName}`,
    '',
    'Sampun transfer, kirim screenshot bukti transfer nang chat iki nggih.',
  ]);
}

async function handleTextReply(text, userId, role, tenant) {
  const normalized = String(text || '').trim().replace(/^\/+/, '').toUpperCase();

  if (role === 'admin' && normalized === 'YA BAYAR') {
    return handleAdminMarkPaidConfirmation(userId);
  }

  if (role === 'tenant' && normalized === 'CASH') {
    return handleCashChoice(userId, tenant);
  }

  if (role === 'tenant' && normalized === 'TRANSFER') {
    return handleTransferChoice(userId, tenant);
  }

  return null;
}

function buildAdminProofCaption(code, pending) {
  return fmt([
    '> *BUKTI PEMBAYARAN LISTRIK*',
    '',
    `Kode Verifikasi: *${code}*`,
    `Nama: *${getTenantName(pending.tenant)}*`,
    `Kamar: *${getTenantRoomCode(pending.tenant)}*`,
    `Gedung: *${getTenantBuildingLabel(pending.tenant)}*`,
    `Periode: *${pending.bulan} ${pending.tahun}*`,
    `Metode: *${electricityService.formatMetodeBayarForAdminDisplay(pending.method)}*`,
    `Nominal: *${formatRupiah(getNominal())}*`,
    '',
    'Balas:',
    `/terima_bukti ${code}`,
    'atau',
    `/tolak_bukti ${code} <alasan>`,
    '',
    'Catetan Bu Umi: kode bukti aktif 24 jam. Menawi langkung saking niku dereng diproses, penghuni kedah kirim ulang bukti nggih.',
  ]);
}

async function handleTerimaBukti(args, sock) {
  const code = martinosPaymentVerificationService.normalizeProofCode(args[0]);
  if (!code || !args[0]) {
    return 'Format: `/terima_bukti <kode>`\nContoh: `/terima_bukti BUKTI-1234`';
  }

  const result = await martinosPaymentVerificationService.approveMartinosProofWithSocket(code, sock);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return fmt([
        `Kode bukti *${code}* ora ketemu utawi sampun kedaluwarsa.`,
        'Kode bukti aktif 24 jam. Bisa ugi bot/VM sempat restart dadi kode ilang.',
        'Monggo cek kode nang pesan bukti, utawi minta penghuni kirim ulang bukti nggih, Bu Umi.',
      ]);
    }
    if (result.reason === 'already_paid') {
      const pending = result.pending || {};
      return fmt([
        '> *Tagihan sudah lunas*',
        '',
        `Kode: *${result.normalized || code}*`,
        `Kamar: *${getTenantRoomCode(pending.tenant)}*`,
        `Penghuni: *${getTenantMasName(pending.tenant)}*`,
        `Periode: *${pending.bulan || '-'} ${pending.tahun || ''}*`.trim(),
        '',
        'Bukti lama iki ora tak proses maneh, Bu Umi, soale tagihane sampun lunas.',
      ]);
    }
    return `Gagal menerima bukti ${code}: ${result.message || 'database error'}`;
  }

  const { pending, updated, tenantNotified } = result;

  return fmt([
    '> *Bukti pembayaran diterima*',
    '',
    `Kode: *${result.normalized}*`,
    `Kamar: *${getTenantRoomCode(pending.tenant)}*`,
    `Penghuni: *${getTenantMasName(pending.tenant)}*`,
    `Periode: *${pending.bulan} ${pending.tahun}*`,
    `Metode: *${updated.metode_bayar || pending.metodeBayar}*`,
    tenantNotified
      ? 'Penghuni wis dikabari.'
      : 'Status sampun lunas, nanging bot gagal ngabarin penghuni sawise dicoba ulang. Bu, tulung kabari penghuni manual nggih.',
  ]);
}

async function handleTolakBukti(args, sock) {
  const code = martinosPaymentVerificationService.normalizeProofCode(args[0]);
  const reason = args.slice(1).join(' ').trim();

  if (!code || !args[0] || !reason) {
    return 'Format: `/tolak_bukti <kode> <alasan>`\nContoh: `/tolak_bukti BUKTI-1234 nominal belum sesuai`';
  }

  const result = await martinosPaymentVerificationService.rejectMartinosProofWithSocket(code, sock, {
    reason,
  });

  if (!result.ok) {
    return fmt([
      `Kode bukti *${code}* ora ketemu utawi sampun kedaluwarsa.`,
      'Kode bukti aktif 24 jam. Bisa ugi bot/VM sempat restart dadi kode ilang.',
      'Monggo cek kode nang pesan bukti, utawi minta penghuni kirim ulang bukti nggih, Bu Umi.',
    ]);
  }

  const { pending, tenantNotified } = result;

  return fmt([
    '> *Bukti pembayaran ditolak*',
    '',
    `Kode: *${result.normalized}*`,
    `Kamar: *${getTenantRoomCode(pending.tenant)}*`,
    `Penghuni: *${getTenantMasName(pending.tenant)}*`,
    `Alasan: *${reason}*`,
    tenantNotified ? 'Penghuni wis dikabari.' : 'Bukti ditolak, tapi notifikasi penghuni gagal dikirim.',
  ]);
}

async function handleKosCommand(command, args, userId, role, tenant, sock, msg) {
  void msg;

  const normalizedCommand = String(command || '').trim().toLowerCase();

  if (!normalizedCommand.startsWith('/')) {
    return handleTextReply(normalizedCommand, userId, role, tenant);
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
      case '/sudah_listrik':
      case '/sudah-listrik':
        try {
          return await handleSudahListrik(args);
        } catch (error) {
          return `Gagal mengambil daftar sudah bayar: ${error.message}`;
        }
      case '/umumkan':
        try {
          return await handleUmumkan(args, userId, sock);
        } catch (error) {
          return `Gagal mengirim pengumuman: ${error.message}`;
        }
      case '/belum_listrik':
        try {
          return await handleBelumListrik(args);
        } catch (error) {
          return `Gagal mengambil daftar belum bayar: ${error.message}`;
        }
      case '/lunas_listrik':
        try {
          return await handleLunasListrik(args, userId);
        } catch (error) {
          return `Gagal menyiapkan konfirmasi pembayaran: ${error.message}`;
        }
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
      case '/sudah_listrik':
      case '/sudah-listrik':
      case '/umumkan':
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

async function handlePendingConfirmation(cleanText, userId, role, tenant, sock) {
  return handleAdminPendingText(cleanText, userId, role, tenant, sock);
}

async function handleProofUpload(msg, userId, tenant, sock) {
  const pending = pendingTenantPayments[userId];
  const media = getProofMedia(msg);
  if (!media) {
    return false;
  }

  const tenantChatJid = toWhatsAppJid(userId) || msg?.key?.remoteJid;
  const replyJid = msg?.key?.remoteJid || tenantChatJid;

  if (!pending || !pending.method) {
    await safeSendMessage(sock, replyJid, {
      text: buildStartPaymentFirstReply(tenant || pending?.tenant),
    }, { quoted: msg });
    return true;
  }

  const adminJid = toWhatsAppJid(process.env.MARTINOS_ADMIN_WA_JID);

  if (!adminJid) {
    await safeSendMessage(sock, replyJid, {
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
    await safeSendMessage(sock, replyJid, {
      text: buildTenantTechnicalIssueReply(
        tenant || pending.tenant,
        'Bukti pembayaran gagal diproses. Coba kirim ulang fotone mengko nggih.',
      ),
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

  const tenantForLog = tenant || pending.tenant;
  console.log('[Martinos] Payment proof received', {
    code,
    tagihanId: pending.billId,
    roomCode: getTenantRoomCode(tenantForLog),
    methodInput: pending.method,
  });

  martinosPaymentVerificationService.registerMartinosProofVerification(code, {
    tenantName: getTenantName(tenantForLog),
    tenantWhatsappJid: tenantChatJid,
    roomCode: getTenantRoomCode(tenantForLog),
    tagihanId: pending.billId || null,
    kamarId: pending.kamarId,
    metodeBayar: pending.method,
    createdAt: Date.now(),
    tenant: tenantForLog,
    bulan: pending.bulan,
    tahun: pending.tahun,
  });

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
    martinosPaymentVerificationService.clearMartinosProofVerification(code);
    console.error('Gagal meneruskan bukti pembayaran Martinos ke admin:', error);
    await safeSendMessage(sock, replyJid, {
      text: buildTenantTechnicalIssueReply(
        tenant || pending.tenant,
        'Bukti pembayaran belum berhasil diteruske ke admin. Monggo kirim ulang mengko sakwise bot normal.',
      ),
    }, { quoted: msg });
    return true;
  }

  clearPending(pendingTenantPayments, userId);

  await safeSendMessage(sock, replyJid, {
    text: fmt([
      `Oke ${getTenantMasName(tenant || pending.tenant)}, bukti pembayaran sampun tak teruske ke admin.`,
      'Mangga ditunggu sek nggih. Nek sampun diverifikasi, nanti tak kabari.',
    ]),
  }, { quoted: msg });

  return true;
}

module.exports = {
  handleKosCommand,
  handleProofUpload,
  handlePendingConfirmation,
  buildAdminProofCaption,
};
