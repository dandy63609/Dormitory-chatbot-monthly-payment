'use strict';

const electricityService = require('./electricityService');
const { normalizePhone } = require('./tenantService');

function toWhatsAppJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;

  const normalized = normalizePhone(raw);
  return normalized ? `${normalized}@s.whatsapp.net` : '';
}

function buildTenantReminderText(tenant) {
  return [
    `Nggih Mas ${tenant.tenantName || 'Penghuni'}, ngelingke tagihan listrik *${tenant.periodLabel}* dereng lunas nggih.`,
    `Kamar: *${tenant.roomCode || '-'}*`,
    tenant.buildingName ? `Gedung: *${tenant.buildingName}*` : null,
    '',
    'Nek badhe bayar, mangga ketik */bayar_listrik*.',
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

async function sendElectricityPaymentReminders(sock, options = {}) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    return { periodLabel: '', sentCount: 0, skippedCount: 0, totalCount: 0, results: [] };
  }

  const now = options.date instanceof Date ? options.date : new Date();
  const bulan = options.bulan || now.getMonth() + 1;
  const tahun = options.tahun || now.getFullYear();
  const { periodLabel, tenants } = await electricityService.getExistingUnpaidTenantsForPeriod(bulan, tahun);
  const results = [];
  let sentCount = 0;
  let skippedCount = 0;

  for (const tenant of tenants) {
    const jid = toWhatsAppJid(tenant.tenantPhone);
    if (!jid) {
      skippedCount += 1;
      results.push({ tagihanId: tenant.tagihanId, roomCode: tenant.roomCode, success: false, skipped: true });
      continue;
    }

    try {
      await sock.sendMessage(jid, { text: buildTenantReminderText({ ...tenant, periodLabel }) });
      sentCount += 1;
      results.push({ tagihanId: tenant.tagihanId, roomCode: tenant.roomCode, jid, success: true });
    } catch (error) {
      skippedCount += 1;
      results.push({
        tagihanId: tenant.tagihanId,
        roomCode: tenant.roomCode,
        jid,
        success: false,
        error: error?.message || String(error),
      });
    }
  }

  return {
    periodLabel,
    sentCount,
    skippedCount,
    totalCount: tenants.length,
    results,
  };
}

module.exports = {
  buildTenantReminderText,
  sendElectricityPaymentReminders,
};
