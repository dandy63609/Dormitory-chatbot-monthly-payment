'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const electricityService = require('../src/services/electricityService');
const martinosPaymentVerificationService = require('../src/services/martinosPaymentVerificationService');
const { buildAdminProofCaption } = require('../src/commands/kos');

const realMarkElectricityPaid = electricityService.markElectricityPaidByTagihanId;
const realMarkElectricityPaidByKamarId = electricityService.markElectricityPaidByKamarId;
const realGetBillById = electricityService.getBillById;
const realGetCurrentTenantBill = electricityService.getCurrentTenantBill;

test('payment proof verification expires after 24 hours', () => {
  assert.equal(
    martinosPaymentVerificationService.PENDING_PROOF_TTL_MS,
    24 * 60 * 60 * 1000,
  );
});

test.afterEach(() => {
  electricityService.markElectricityPaidByTagihanId = realMarkElectricityPaid;
  electricityService.markElectricityPaidByKamarId = realMarkElectricityPaidByKamarId;
  electricityService.getBillById = realGetBillById;
  electricityService.getCurrentTenantBill = realGetCurrentTenantBill;
});

function stubTenant() {
  return { nama_penyewa: 'Budi', nomor_kamar: 'M1-01', gedung: { nama: 'Gedung A' } };
}

test('proof registration normalizes TRANSFER and CASH to DB metode_bayar labels', () => {
  martinosPaymentVerificationService.registerMartinosProofVerification('BUKTI-9101', {
    tenantName: 'A',
    tenantWhatsappJid: 'local-test@s.whatsapp.net',
    roomCode: 'R1',
    tagihanId: 't91',
    metodeBayar: 'TRANSFER',
    tenant: stubTenant(),
  });
  let row = martinosPaymentVerificationService.getMartinosProofVerification('9101');
  assert.equal(row.metodeBayar, 'Transfer Bank');
  assert.equal(row.metodeBayarInput, 'TRANSFER');
  martinosPaymentVerificationService.clearMartinosProofVerification('9101');

  martinosPaymentVerificationService.registerMartinosProofVerification('BUKTI-9102', {
    tenantName: 'B',
    tenantWhatsappJid: 'local-test@s.whatsapp.net',
    roomCode: 'R2',
    tagihanId: 't92',
    metodeBayar: 'CASH',
    tenant: stubTenant(),
  });
  row = martinosPaymentVerificationService.getMartinosProofVerification('9102');
  assert.equal(row.metodeBayar, 'Tunai');
  assert.equal(row.metodeBayarInput, 'CASH');
  martinosPaymentVerificationService.clearMartinosProofVerification('9102');
});

test('approveMartinosProofWithSocket calls markElectricityPaidByTagihanId with normalized method', async () => {
  let receivedMethod;
  electricityService.getBillById = async () => ({
    id: 'tid-9201',
    status_bayar: 'Belum Bayar',
  });
  electricityService.markElectricityPaidByTagihanId = async (_tagihanId, method) => {
    receivedMethod = method;
    return { metode_bayar: method, status_bayar: 'Lunas' };
  };

  const sock = { sendMessage: async () => {} };

  martinosPaymentVerificationService.registerMartinosProofVerification('BUKTI-9201', {
    tenantName: 'A',
    tenantWhatsappJid: 'local-test@s.whatsapp.net',
    roomCode: 'R9',
    tagihanId: 'tid-9201',
    metodeBayar: 'cash',
    tenant: stubTenant(),
  });

  const result = await martinosPaymentVerificationService.approveMartinosProofWithSocket('9201', sock);
  assert.equal(result.ok, true);
  assert.equal(receivedMethod, 'Tunai');
  assert.equal(martinosPaymentVerificationService.getMartinosProofVerification('9201'), null);
});

test('approveMartinosProofWithSocket retries tenant notification once after send failure', async () => {
  electricityService.getBillById = async () => ({
    id: 'tid-9202',
    status_bayar: 'Belum Bayar',
  });
  electricityService.markElectricityPaidByTagihanId = async (_tagihanId, method) => ({
    metode_bayar: method,
    status_bayar: 'Lunas',
  });

  let sendCalls = 0;
  const sock = {
    sendMessage: async () => {
      sendCalls += 1;
      if (sendCalls === 1) {
        throw new Error('temporary send failure');
      }
    },
  };

  martinosPaymentVerificationService.registerMartinosProofVerification('BUKTI-9202', {
    tenantName: 'A',
    tenantWhatsappJid: 'local-test@s.whatsapp.net',
    roomCode: 'R9',
    tagihanId: 'tid-9202',
    metodeBayar: 'transfer',
    tenant: stubTenant(),
  });

  const result = await martinosPaymentVerificationService.approveMartinosProofWithSocket('9202', sock);
  assert.equal(result.ok, true);
  assert.equal(result.tenantNotified, true);
  assert.equal(sendCalls, 2);
});

test('approveMartinosProofWithSocket creates a paid row when no bill row exists', async () => {
  let received;
  electricityService.getCurrentTenantBill = async () => null;
  electricityService.markElectricityPaidByKamarId = async (kamarId, bulan, tahun, method) => {
    received = { kamarId, bulan, tahun, method };
    return {
      id: 'created-paid-row',
      metode_bayar: method,
      status_bayar: 'Lunas',
    };
  };

  const sock = { sendMessage: async () => {} };

  martinosPaymentVerificationService.registerMartinosProofVerification('BUKTI-9250', {
    tenantName: 'A',
    tenantWhatsappJid: 'local-test@s.whatsapp.net',
    roomCode: 'R9',
    kamarId: 'room-9250',
    metodeBayar: 'transfer',
    tenant: stubTenant(),
    bulan: 'Mei',
    tahun: 2026,
  });

  const result = await martinosPaymentVerificationService.approveMartinosProofWithSocket('9250', sock);
  assert.equal(result.ok, true);
  assert.deepEqual(received, {
    kamarId: 'room-9250',
    bulan: 'Mei',
    tahun: 2026,
    method: 'Transfer Bank',
  });
});

test('rejectMartinosProofWithSocket does not call markElectricityPaidByTagihanId', async () => {
  let markCalls = 0;
  electricityService.markElectricityPaidByTagihanId = async () => {
    markCalls += 1;
    return {};
  };

  const sock = { sendMessage: async () => {} };

  martinosPaymentVerificationService.registerMartinosProofVerification('BUKTI-9301', {
    tenantName: 'A',
    tenantWhatsappJid: 'local-test@s.whatsapp.net',
    roomCode: 'R9',
    tagihanId: 'tid-9301',
    metodeBayar: 'transfer',
    tenant: stubTenant(),
  });

  const result = await martinosPaymentVerificationService.rejectMartinosProofWithSocket('9301', sock, {
    reason: 'tidak jelas',
  });
  assert.equal(result.ok, true);
  assert.equal(markCalls, 0);
  assert.equal(martinosPaymentVerificationService.getMartinosProofVerification('9301'), null);
});

test('WhatsApp admin proof caption lists /terima_bukti and /tolak_bukti with the proof code', () => {
  const caption = buildAdminProofCaption('BUKTI-9401', {
    method: 'transfer',
    bulan: 'Mei',
    tahun: 2026,
    tenant: stubTenant(),
  });
  assert.match(caption, /\/terima_bukti BUKTI-9401/);
  assert.match(caption, /\/tolak_bukti BUKTI-9401/);
  assert.match(caption, /aktif 24 jam/);
});
