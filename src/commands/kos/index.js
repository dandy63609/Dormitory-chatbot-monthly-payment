'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const electricityService = require('../../services/electricityService');
const martinosAnnouncementService = require('../../services/martinosAnnouncementService');

// ---------------------------------------------------------------------------
// In-memory pending state — keyed by WhatsApp userId (JID string)
// Entries are auto-deleted via setTimeout. Bot restart clears everything.
// ---------------------------------------------------------------------------
const pendingElectricityPayments = {}; // admin:  { roomCode, bulan, tahun, method }
const pendingAnnouncements       = {}; // admin:  { target, message }
const pendingProofUpload         = {}; // tenant: { tenant, bulan, tahun }
const pendingVerifications       = {}; // keyed by verification code string

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setPending(map, key, value, ttlMs) {
  map[key] = value;
  setTimeout(() => { delete map[key]; }, ttlMs);
}

function generateVerificationCode() {
  // Exclude O/0 and I/1 to reduce transcription errors
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `BUKTI-${code}`;
}

function getCurrentMonthYear() {
  const now = new Date();
  return {
    bulan: electricityService.getMonthName(now.getMonth() + 1),
    tahun: String(now.getFullYear()),
  };
}

/** Filter out falsy lines then join with newline */
function fmt(lines) {
  return lines.filter(line => line !== null && line !== undefined && line !== false).join('\n');
}

// ---------------------------------------------------------------------------
// Admin command handlers
// ---------------------------------------------------------------------------

function buildKosInfoMenu() {
  return fmt([
    '> *MENU ADMIN MARTINOS KOS* 🏠',
    '',
    '*PERINTAH LISTRIK:*',
    '- `/listrik <bulan> <tahun>` : Ringkasan pembayaran',
    '- `/belum_listrik <bulan> <tahun>` : Daftar belum bayar',
    '- `/lunas_listrik <kamar> <bulan> <tahun> <metode>` : Tandai lunas',
    '',
    '*VERIFIKASI BUKTI BAYAR:*',
    '- `/terima_bukti <kode> <metode>` : Terima bukti bayar penghuni',
    '- `/tolak_bukti <kode> <alasan>` : Tolak bukti bayar penghuni',
    '',
    '*PENGUMUMAN:*',
    '- `/umumkan semua <pesan>` : Kirim ke semua grup',
    '- `/umumkan martinos1 <pesan>` : Kirim ke grup Martinos 1',
    '- `/umumkan martinos2 <pesan>` : Kirim ke grup Martinos 2',
    '- `/umumkan martinos3 <pesan>` : Kirim ke grup Martinos 3',
    '',
    '*CONTOH:*',
    '`/listrik mei 2025`',
    '`/belum_listrik mei 2025`',
    '`/lunas_listrik M1-1303 mei 2025 qris`',
    '`/umumkan semua Besok air mati jam 10 pagi`',
  ]);
}

async function handleListrik(args) {
  const [bulan, tahun] = args;
  if (!bulan || !tahun) {
    return '❌ Format: `/listrik <bulan> <tahun>`\nContoh: `/listrik mei 2025`';
  }
  const summary = await electricityService.getElectricitySummary(bulan, tahun);
  const buildingLines = summary.buildings.length > 0
    ? summary.buildings.map(b => `- *${b.name}*: ${b.paid}/${b.total} lunas`).join('\n')
    : '(belum ada data per gedung)';
  const amountLine = summary.amountPerPerson
    ? `Iuran/orang: *Rp ${Number(summary.amountPerPerson).toLocaleString('id-ID')}*`
    : null;
  return fmt([
    `> *RINGKASAN LISTRIK ${summary.periodLabel.toUpperCase()}*`,
    '',
    `Periode: *${summary.periodLabel}*`,
    amountLine,
    '',
    `Total penghuni: *${summary.totalTenants}*`,
    `Sudah lunas: *${summary.totalPaid}* ✅`,
    `Belum lunas: *${summary.totalUnpaid}* ⏳`,
    '',
    '*Per Gedung:*',
    buildingLines,
  ]);
}

async function handleBelumListrik(args) {
  const [bulan, tahun] = args;
  if (!bulan || !tahun) {
    return '❌ Format: `/belum_listrik <bulan> <tahun>`\nContoh: `/belum_listrik mei 2025`';
  }
  const result = await electricityService.getUnpaidTenants(bulan, tahun);
  if (result.tenants.length === 0) {
    return `> *BELUM BAYAR LISTRIK ${result.periodLabel.toUpperCase()}*\n\n✅ Semua penghuni sudah lunas!`;
  }
  const lines = result.tenants.map((t, i) =>
    `${i + 1}. *${t.roomCode}* — ${t.tenantName} (${t.buildingName})`
  );
  return fmt([
    `> *BELUM BAYAR LISTRIK ${result.periodLabel.toUpperCase()}*`,
    '',
    `Total: *${result.tenants.length}* penghuni belum bayar.`,
    '',
    ...lines,
  ]);
}

function handleLunasListrik(args, userId) {
  const [roomCode, bulan, tahun, method] = args;
  if (!roomCode || !bulan || !tahun || !method) {
    return '❌ Format: `/lunas_listrik <kamar> <bulan> <tahun> <metode>`\nContoh: `/lunas_listrik M1-1303 mei 2025 qris`';
  }
  setPending(pendingElectricityPayments, userId, { roomCode, bulan, tahun, method }, 5 * 60 * 1000);
  return fmt([
    'Bu, tak konfirmasi dulu ya.',
    '',
    'Akan ditandai lunas:',
    `Kamar: *${roomCode}*`,
    `Periode: *${bulan} ${tahun}*`,
    `Metode: *${method.toUpperCase()}*`,
    '',
    'Ketik *YA BAYAR* untuk menyimpan.',
  ]);
}

async function handleUmumkan(args, userId) {
  const [target, ...rest] = args;
  const message = rest.join(' ').trim();
  const validTargets = ['semua', 'martinos1', 'martinos2', 'martinos3'];
  const normalizedTarget = String(target || '').toLowerCase();
  if (!normalizedTarget || !validTargets.includes(normalizedTarget)) {
    return '❌ Format: `/umumkan <target> <pesan>`\nTarget: semua, martinos1, martinos2, martinos3\nContoh: `/umumkan semua Besok air mati jam 10 pagi`';
  }
  if (!message) {
    return '❌ Pesan pengumuman tidak boleh kosong.';
  }
  const labelMap = {
    semua:     'Martinos Kos 1, 2, dan 3',
    martinos1: 'Martinos Kos 1',
    martinos2: 'Martinos Kos 2',
    martinos3: 'Martinos Kos 3',
  };
  setPending(pendingAnnouncements, userId, { target: normalizedTarget, message }, 5 * 60 * 1000);
  return fmt([
    'Bu, pengumuman iki akan dikirim ke:',
    `- ${labelMap[normalizedTarget]}`,
    '',
    'Isi:',
    message,
    '',
    'Ketik *KIRIM PENGUMUMAN* untuk mengirim.',
  ]);
}

async function handleTerimaBukti(args, userId, sock) {
  const [rawCode, ...methodParts] = args;
  const code = String(rawCode || '').trim().toUpperCase();
  const method = methodParts.join(' ').trim() || 'transfer';
  if (!code) {
    return '❌ Format: `/terima_bukti <kode> <metode>`\nContoh: `/terima_bukti BUKTI-8F2K qris`';
  }
  const v = pendingVerifications[code];
  if (!v) {
    return 'Ngapunten Bu, kode verifikasi iki wis ora aktif utawa ora ketemu.';
  }
  await electricityService.markElectricityPaid(v.roomCode, v.bulan, v.tahun, method, userId);
  try {
    await sock.sendMessage(v.tenantUserId, {
      text: fmt([
        '> *Pembayaran listrik wis diverifikasi* ✅',
        '',
        'Matur nuwun ya, Mas/Mbak.',
        `Pembayaran listrik bulan ${v.bulan} ${v.tahun} wis diterima lan dicatet lunas.`,
      ]),
    });
  } catch (e) {
    console.error('[kos] Failed to notify tenant after /terima_bukti:', e.message);
  }
  delete pendingVerifications[code];
  return `✅ Pembayaran listrik *${v.roomCode}* bulan ${v.bulan} ${v.tahun} wis dicatet lunas.`;
}

async function handleTolakBukti(args, userId, sock) {
  const [rawCode, ...reasonParts] = args;
  const code = String(rawCode || '').trim().toUpperCase();
  const reason = reasonParts.join(' ').trim() || '(tanpa keterangan)';
  if (!code) {
    return '❌ Format: `/tolak_bukti <kode> <alasan>`\nContoh: `/tolak_bukti BUKTI-8F2K nominal tidak sesuai`';
  }
  const v = pendingVerifications[code];
  if (!v) {
    return 'Ngapunten Bu, kode verifikasi iki wis ora aktif utawa ora ketemu.';
  }
  try {
    await sock.sendMessage(v.tenantUserId, {
      text: fmt([
        '> *Bukti pembayaran durung iso diverifikasi* 🙏',
        '',
        'Ngapunten ya, Mas/Mbak.',
        `Bukti pembayaran listrik bulan ${v.bulan} ${v.tahun} durung iso diterima.`,
        '',
        'Catatan admin:',
        reason,
        '',
        'Mangga kirim ulang bukti pembayaran sing bener ya.',
      ]),
    });
  } catch (e) {
    console.error('[kos] Failed to notify tenant after /tolak_bukti:', e.message);
  }
  delete pendingVerifications[code];
  return `Baik Bu, bukti dari *${v.tenantName}* (*${v.roomCode}*) ditolak. Penghuni sudah diberitahu.`;
}

// ---------------------------------------------------------------------------
// Tenant command handlers
// ---------------------------------------------------------------------------

function buildTenantInfoMenu(tenant) {
  const name     = tenant?.name || 'Penghuni';
  const roomCode = tenant?.rooms?.code || '-';
  return fmt([
    `> *Sugeng rawuh, ${name}!* 🏠`,
    '',
    `Kamu terdaftar di kamar *${roomCode}*.`,
    '',
    '*Menu Penghuni:*',
    '- `/listrik_saya` : Status listrik bulanku',
    '- `/status_bayar <bulan> <tahun>` : Cek status bayar bulan tertentu',
    '- `/bayar_listrik` : Cara kirim bukti pembayaran',
  ]);
}

async function handleListrikSaya(tenant) {
  if (!tenant?.id) return '❌ Data penghuni tidak ditemukan.';
  const { bulan, tahun } = getCurrentMonthYear();
  const status   = await electricityService.getOwnElectricityStatus(tenant.id, bulan, tahun);
  const roomCode = tenant?.rooms?.code || '-';
  if (!status) {
    return fmt([
      `> *STATUS LISTRIK ${bulan.toUpperCase()} ${tahun}*`,
      '',
      'Data listrik bulan ini belum tersedia.',
      'Hubungi ibu kos untuk informasi lebih lanjut.',
    ]);
  }
  const statusLine = status.isPaid
    ? `✅ *LUNAS*${status.paidAt ? ` (${new Date(status.paidAt).toLocaleDateString('id-ID')})` : ''}`
    : '⏳ *BELUM LUNAS*';
  return fmt([
    `> *STATUS LISTRIK ${bulan.toUpperCase()} ${tahun}*`,
    '',
    `Kamar: *${roomCode}*`,
    `Periode: *${status.periodLabel}*`,
    status.amountPerPerson
      ? `Iuran: *Rp ${Number(status.amountPerPerson).toLocaleString('id-ID')}*`
      : null,
    `Status: ${statusLine}`,
    status.isPaid && status.paymentMethod ? `Metode: ${status.paymentMethod}` : null,
  ]);
}

async function handleStatusBayar(args, tenant) {
  const [bulan, tahun] = args;
  if (!bulan || !tahun) {
    return '❌ Format: `/status_bayar <bulan> <tahun>`\nContoh: `/status_bayar mei 2025`';
  }
  if (!tenant?.id) return '❌ Data penghuni tidak ditemukan.';
  const status   = await electricityService.getOwnElectricityStatus(tenant.id, bulan, tahun);
  const roomCode = tenant?.rooms?.code || '-';
  if (!status) {
    const mn    = electricityService.parseMonthToNumber(bulan);
    const label = mn ? `${electricityService.getMonthName(mn)} ${tahun}` : `${bulan} ${tahun}`;
    return `> *STATUS BAYAR ${label.toUpperCase()}*\n\nData untuk periode ini belum tersedia.`;
  }
  const statusLine = status.isPaid
    ? `✅ *LUNAS*${status.paidAt ? ` (${new Date(status.paidAt).toLocaleDateString('id-ID')})` : ''}`
    : '⏳ *BELUM LUNAS*';
  return fmt([
    `> *STATUS BAYAR ${status.periodLabel.toUpperCase()}*`,
    '',
    `Kamar: *${roomCode}*`,
    `Periode: *${status.periodLabel}*`,
    status.amountPerPerson
      ? `Iuran: *Rp ${Number(status.amountPerPerson).toLocaleString('id-ID')}*`
      : null,
    `Status: ${statusLine}`,
    status.isPaid && status.paymentMethod ? `Metode: ${status.paymentMethod}` : null,
  ]);
}

function handleBayarListrik(userId, tenant) {
  const { bulan, tahun } = getCurrentMonthYear();
  setPending(pendingProofUpload, userId, { tenant, bulan, tahun }, 10 * 60 * 1000);
  return fmt([
    '> *Cara Kirim Bukti Bayar Listrik* 📸',
    '',
    'Kirim foto atau dokumen bukti transfer kamu ke chat ini sekarang ya.',
    '',
    'Bukti akan langsung diteruskan ke ibu kos untuk diverifikasi.',
    'Status listrik baru berubah lunas setelah ibu kos konfirmasi.',
  ]);
}

// ---------------------------------------------------------------------------
// Proof upload handler
// Called from waHandler when tenant sends an image or document.
// Returns true if the upload was handled (caller should return early).
// Returns false if no pending state exists (caller continues normally).
// ---------------------------------------------------------------------------

async function handleProofUpload(msg, userId, tenant, sock) {
  const pending = pendingProofUpload[userId];
  if (!pending) return false;

  const isImage    = !!msg.message?.imageMessage;
  const isDocument = !!msg.message?.documentMessage;
  if (!isImage && !isDocument) return false;

  const remoteJid = msg.key.remoteJid;
  const adminJid  = process.env.MARTINOS_ADMIN_WA_JID;

  if (!adminJid || !adminJid.trim()) {
    await sock.sendMessage(remoteJid, {
      text: 'Ngapunten, sistem verifikasi pembayaran durung aktif. Hubungi admin kos dulu ya.',
    });
    delete pendingProofUpload[userId];
    return true;
  }

  const { bulan, tahun }   = pending;
  const tenantRecord       = pending.tenant || tenant || {};
  const tenantName         = tenantRecord?.name || 'Penghuni';
  const roomCode           = tenantRecord?.rooms?.code || '-';
  // ⚠️ CONFIRM: whatsapp_number column name
  const tenantPhone        = tenantRecord?.whatsapp_number || '-';
  const verificationCode   = generateVerificationCode();

  // Download buffer (only for forwarding — not stored)
  let proofBuffer;
  try {
    proofBuffer = await downloadMediaMessage(
      msg, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage }
    );
  } catch (err) {
    console.error('[kos] Failed to download proof buffer:', err.message);
    await sock.sendMessage(remoteJid, {
      text: '❌ Gagal memproses bukti pembayaran. Coba kirim ulang ya.',
    });
    return true;
  }

  const mimeType = (isImage
    ? msg.message.imageMessage?.mimetype
    : msg.message.documentMessage?.mimetype) || 'image/jpeg';
  const fileName = (isDocument && msg.message.documentMessage?.fileName)
    || `bukti_${verificationCode}.jpg`;

  const adminText = [
    '*Bukti Pembayaran Listrik Masuk* 🧾',
    '',
    'Bu, ana bukti transfer mlebu.',
    '',
    `Kode Verifikasi: *${verificationCode}*`,
    `Nama: ${tenantName}`,
    `Kamar: ${roomCode}`,
    `Periode: ${bulan} ${tahun}`,
    `Nomor WA: ${tenantPhone}`,
    '',
    'Bukti pembayaran tak teruske nang ngisor iki ya, Bu.',
    '',
    `Nek pembayaran iki wis bener, balas:\n\`/terima_bukti ${verificationCode} qris\``,
    '',
    `Nek durung cocok, balas:\n\`/tolak_bukti ${verificationCode} alasan\``,
  ].join('\n');

  try {
    // 1. Admin notification text
    await sock.sendMessage(adminJid, { text: adminText });
    // 2. Forward the proof media (buffer discarded after this)
    if (isImage) {
      await sock.sendMessage(adminJid, {
        image: proofBuffer, mimetype: mimeType,
        caption: `Bukti dari ${tenantName} — ${verificationCode}`,
      });
    } else {
      await sock.sendMessage(adminJid, {
        document: proofBuffer, mimetype: mimeType, fileName,
        caption: `Bukti dari ${tenantName} — ${verificationCode}`,
      });
    }
  } catch (err) {
    console.error('[kos] Failed to forward proof to admin:', err.message);
    await sock.sendMessage(remoteJid, {
      text: '❌ Gagal meneruskan bukti ke ibu kos. Coba lagi nanti ya.',
    });
    delete pendingProofUpload[userId];
    return true;
  }

  // 3. Store verification record (30-min expiry)
  setPending(pendingVerifications, verificationCode, {
    code:         verificationCode,
    tenantUserId: remoteJid,
    tenantId:     tenantRecord?.id,
    tenantName,
    tenantPhone,
    roomCode,
    bulan,
    tahun,
    createdAt: Date.now(),
  }, 30 * 60 * 1000);

  // 4. Clear upload pending — buffer is now out of scope and will be GC'd
  delete pendingProofUpload[userId];

  // 5. Reply tenant
  await sock.sendMessage(remoteJid, {
    text: fmt([
      '> *Bukti pembayaran wis tak teruske ke admin ya* 🧾',
      '',
      'Matur nuwun, Mas/Mbak.',
      'Nanti ibu kos tak cek dulu.',
      'Status listrik baru berubah lunas setelah diverifikasi admin.',
    ]),
  });

  return true;
}

// ---------------------------------------------------------------------------
// Pending confirmation handler
// Called from waHandler for every non-command text message from known users.
// Returns a reply string if the text was a confirmation keyword, else null.
// null = fall through to AI chat as normal.
// ---------------------------------------------------------------------------

async function handlePendingConfirmation(cleanText, userId, role, sock) {
  const upper = String(cleanText || '').trim().toUpperCase();

  if (upper === 'YA BAYAR' && role === 'admin') {
    const pending = pendingElectricityPayments[userId];
    if (!pending) return null; // no pending action — pass to AI
    const { roomCode, bulan, tahun, method } = pending;
    try {
      await electricityService.markElectricityPaid(roomCode, bulan, tahun, method, userId);
      delete pendingElectricityPayments[userId];
      return `✅ Sukses! Pembayaran listrik kamar *${roomCode}* bulan ${bulan} ${tahun} wis dicatet lunas (${method.toUpperCase()}).`;
    } catch (err) {
      delete pendingElectricityPayments[userId];
      return `❌ Gagal menyimpan: ${err.message}`;
    }
  }

  if (upper === 'KIRIM PENGUMUMAN' && role === 'admin') {
    const pending = pendingAnnouncements[userId];
    if (!pending) return null;
    const { target, message } = pending;
    try {
      const result = await martinosAnnouncementService.sendAnnouncement(sock, target, message);
      delete pendingAnnouncements[userId];
      await martinosAnnouncementService.logAnnouncement(target, message, userId);
      return `✅ Pengumuman terkirim ke ${result.successCount}/${result.totalCount} grup!`;
    } catch (err) {
      delete pendingAnnouncements[userId];
      return `❌ Gagal kirim pengumuman: ${err.message}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main dispatcher
// Returns a reply string, or null if this is not a Martinos-specific command
// (null tells waHandler to fall through to the existing switch cases).
// ---------------------------------------------------------------------------

async function handleKosCommand(command, args, userId, role, tenant, sock) {
  // /start — simple welcome for any known role
  if (command === '/start') {
    return fmt([
      '> *Sugeng rawuh nang Martinos Kos* 🏠',
      '',
      'Halo! Ketik /info kanggo ndelok menu sesuai peranmu ya.',
    ]);
  }

  // /info — role-aware menu
  if (command === '/info') {
    if (role === 'admin')  return fmt(['> *Halo, Bu!* 🙏', '', 'Gunakan /kos_info untuk melihat menu admin lengkap.']);
    if (role === 'tenant') return buildTenantInfoMenu(tenant);
    return null;
  }

  // Admin commands
  if (role === 'admin') {
    switch (command) {
      case '/kos_info':      return buildKosInfoMenu();
      case '/listrik':       try { return await handleListrik(args); }      catch (e) { return `❌ ${e.message}`; }
      case '/belum_listrik': try { return await handleBelumListrik(args); } catch (e) { return `❌ ${e.message}`; }
      case '/lunas_listrik': return handleLunasListrik(args, userId);
      case '/umumkan':       try { return await handleUmumkan(args, userId); }       catch (e) { return `❌ ${e.message}`; }
      case '/terima_bukti':  try { return await handleTerimaBukti(args, userId, sock); }  catch (e) { return `❌ ${e.message}`; }
      case '/tolak_bukti':   try { return await handleTolakBukti(args, userId, sock); }   catch (e) { return `❌ ${e.message}`; }
      // Tenant-only commands attempted by admin
      case '/listrik_saya':
      case '/status_bayar':
      case '/bayar_listrik':
        return '> *Perintah iku khusus penghuni kos.* 🏠\nUntuk admin, gunakan /kos_info.';
      default: return null;
    }
  }

  // Tenant commands
  if (role === 'tenant') {
    switch (command) {
      case '/listrik_saya':  try { return await handleListrikSaya(tenant); }           catch (e) { return `❌ ${e.message}`; }
      case '/status_bayar':  try { return await handleStatusBayar(args, tenant); }     catch (e) { return `❌ ${e.message}`; }
      case '/bayar_listrik': return handleBayarListrik(userId, tenant);
      // Admin-only commands attempted by tenant
      case '/kos_info':
      case '/listrik':
      case '/belum_listrik':
      case '/lunas_listrik':
      case '/umumkan':
      case '/terima_bukti':
      case '/tolak_bukti':
        return '> *Ngapunten ya* 🙏\nFitur iki khusus admin Martinos Kos.';
      default: return null;
    }
  }

  return null;
}

module.exports = { handleKosCommand, handleProofUpload, handlePendingConfirmation };
