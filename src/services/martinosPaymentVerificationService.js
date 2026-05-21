'use strict';

const electricityService = require('./electricityService');

const PENDING_PROOF_TTL_MS = 24 * 60 * 60 * 1000;
const TENANT_NOTIFY_RETRY_DELAY_MS = 250;

/** @type {Record<string, object>} */
const pendingProofVerifications = {};

function setPending(map, key, value, ttlMs = PENDING_PROOF_TTL_MS) {
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

function normalizeProofCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  return raw.startsWith('BUKTI-') ? raw : `BUKTI-${raw}`;
}

function isProofCodeInUse(code) {
  const normalized = normalizeProofCode(code);
  return Boolean(pendingProofVerifications[normalized]);
}

/**
 * @param {string} code
 * @param {object} record
 * @param {string} record.tenantName
 * @param {string} record.tenantWhatsappJid
 * @param {string} record.roomCode
 * @param {string|null} [record.tagihanId]
 * @param {string|number} [record.kamarId]
 * @param {string} record.metodeBayar
 * @param {number} [record.createdAt]
 * @param {object} [record.tenant]
 * @param {string} [record.bulan]
 * @param {number} [record.tahun]
 */
function registerMartinosProofVerification(code, record) {
  const normalized = normalizeProofCode(code);
  const createdAt = record.createdAt ?? Date.now();
  const methodInput = String(record.metodeBayar ?? '').trim();
  const metodeBayar = electricityService.formatMetodeBayarForAdminDisplay(record.metodeBayar);
  const roomCode = String(record.roomCode || '').trim() || '-';

  setPending(pendingProofVerifications, normalized, {
    code: normalized,
    tenantName: String(record.tenantName || '').trim() || '-',
    tenantWhatsappJid: String(record.tenantWhatsappJid || '').trim(),
    roomCode,
    tagihanId: record.tagihanId || null,
    kamarId: record.kamarId || null,
    metodeBayar,
    metodeBayarInput: methodInput,
    createdAt,
    tenant: record.tenant,
    bulan: record.bulan,
    tahun: record.tahun,
  });

  console.log('[Martinos] proof verification registered', {
    code: normalized,
    tagihanId: record.tagihanId || null,
    roomCode,
    methodInput,
    normalizedMetodeBayar: metodeBayar,
    success: true,
  });
}

function getMartinosProofVerification(code) {
  const normalized = normalizeProofCode(code);
  const row = pendingProofVerifications[normalized];
  if (!row) return null;
  return row;
}

function clearMartinosProofVerification(code) {
  const normalized = normalizeProofCode(code);
  clearPending(pendingProofVerifications, normalized);
}

async function sendTenantWhatsApp(sock, jid, text) {
  if (!sock || !jid || !text) return false;
  try {
    await sock.sendMessage(jid, { text });
    return true;
  } catch (error) {
    console.error('[Martinos] Tenant WhatsApp notify failed:', error.message);
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTenantWhatsAppWithRetry(sock, jid, text) {
  const firstAttempt = await sendTenantWhatsApp(sock, jid, text);
  if (firstAttempt) {
    return true;
  }

  await wait(TENANT_NOTIFY_RETRY_DELAY_MS);
  return sendTenantWhatsApp(sock, jid, text);
}

const TENANT_TEXT_APPROVED =
  'Horee, bukti pembayaran listrikmu sampun diverifikasi Bu Kos. Matur nuwun sampun mbayar nggih 🙏';
const TENANT_TEXT_REJECTED_GENERIC =
  'Halo, bukti pembayaran listrikmu dereng saged diverifikasi. Cobi kirim ulang bukti pembayaran sing luwih jelas nggih 🙏';

function buildTenantRejectMessage(reason) {
  const trimmed = String(reason || '').trim();
  if (!trimmed) {
    return TENANT_TEXT_REJECTED_GENERIC;
  }
  return [
    TENANT_TEXT_REJECTED_GENERIC,
    '',
    `Alasan saking admin: *${trimmed}*`,
    '',
    'Tulung kirim ulang lewat */bayar_listrik* ya.',
  ].join('\n');
}

/**
 * Shared approve path for WhatsApp admin commands.
 * @param {string} code
 * @param {object | null} sock
 * @returns {Promise<{ ok: true, normalized: string, pending: object, updated: object, tenantNotified: boolean } | { ok: false, reason: 'not_found'|'db_error'|'already_paid', message?: string, pending?: object, existingBill?: object, normalized?: string }>}
 */
async function approveMartinosProofWithSocket(code, sock) {
  const normalized = normalizeProofCode(code);
  const pending = pendingProofVerifications[normalized];
  if (!pending) {
    console.log('[Martinos] proof approve skipped', {
      code: normalized,
      success: false,
      failure: true,
      reason: 'not_found',
    });
    return { ok: false, reason: 'not_found' };
  }

  const methodInput = pending.metodeBayarInput ?? pending.metodeBayar;

  try {
    const existingBill = pending.tagihanId
      ? await electricityService.getBillById(pending.tagihanId)
      : await electricityService.getCurrentTenantBill(
        pending.kamarId,
        pending.bulan,
        pending.tahun,
      );

    if (electricityService.isPaid(existingBill?.status_bayar)) {
      clearPending(pendingProofVerifications, normalized);
      console.log('[Martinos] proof approve skipped', {
        code: normalized,
        tagihanId: pending.tagihanId,
        roomCode: pending.roomCode,
        methodInput,
        normalizedMetodeBayar: existingBill.metode_bayar ?? pending.metodeBayar,
        success: false,
        failure: false,
        reason: 'already_paid',
      });
      return {
        ok: false,
        reason: 'already_paid',
        pending,
        existingBill,
        normalized,
      };
    }

    const updated = existingBill
      ? await electricityService.markElectricityPaidByTagihanId(
        existingBill.id,
        pending.metodeBayar,
        { code: normalized, roomCode: pending.roomCode ?? null },
      )
      : await electricityService.markElectricityPaidByKamarId(
        pending.kamarId,
        pending.bulan,
        pending.tahun,
        pending.metodeBayar,
        { code: normalized, roomCode: pending.roomCode ?? null },
      );
    clearPending(pendingProofVerifications, normalized);
    const tenantNotified = await sendTenantWhatsAppWithRetry(sock, pending.tenantWhatsappJid, TENANT_TEXT_APPROVED);

    console.log('[Martinos] proof approved', {
      code: normalized,
      tagihanId: pending.tagihanId,
      roomCode: pending.roomCode,
      methodInput,
      normalizedMetodeBayar: updated?.metode_bayar ?? pending.metodeBayar,
      tenantNotified,
      success: true,
      failure: false,
    });

    return { ok: true, normalized, pending, updated, tenantNotified };
  } catch (error) {
    console.log('[Martinos] proof approve failed', {
      code: normalized,
      tagihanId: pending.tagihanId,
      roomCode: pending.roomCode,
      methodInput,
      normalizedMetodeBayar: pending.metodeBayar,
      success: false,
      failure: true,
    });
    console.error('[Martinos] Supabase update failed:', error.message);
    return { ok: false, reason: 'db_error', message: error.message };
  }
}

/**
 * Shared reject path for WhatsApp admin commands.
 * Does not update tagihan_listrik paid status.
 * @param {string} code
 * @param {object | null} sock
 * @param {{ reason?: string }} [options]
 */
async function rejectMartinosProofWithSocket(code, sock, options = {}) {
  const normalized = normalizeProofCode(code);
  const pending = pendingProofVerifications[normalized];
  if (!pending) {
    console.log('[Martinos] proof reject skipped', {
      code: normalized,
      success: false,
      failure: true,
      reason: 'not_found',
    });
    return { ok: false, reason: 'not_found' };
  }

  const methodInput = pending.metodeBayarInput ?? pending.metodeBayar;
  clearPending(pendingProofVerifications, normalized);

  const tenantText = buildTenantRejectMessage(options.reason);
  const tenantNotified = await sendTenantWhatsApp(sock, pending.tenantWhatsappJid, tenantText);

  console.log('[Martinos] proof rejected', {
    code: normalized,
    tagihanId: pending.tagihanId,
    roomCode: pending.roomCode,
    methodInput,
    normalizedMetodeBayar: pending.metodeBayar,
    tenantNotified,
    success: true,
    failure: false,
  });

  return { ok: true, normalized, pending, tenantNotified };
}

module.exports = {
  PENDING_PROOF_TTL_MS,
  TENANT_NOTIFY_RETRY_DELAY_MS,
  normalizeProofCode,
  isProofCodeInUse,
  registerMartinosProofVerification,
  getMartinosProofVerification,
  clearMartinosProofVerification,
  approveMartinosProofWithSocket,
  rejectMartinosProofWithSocket,
};
