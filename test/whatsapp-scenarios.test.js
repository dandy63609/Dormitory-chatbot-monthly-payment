'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.OPENROUTER_API_KEY ||= 'test-openrouter-key';

const electricityService = require('../src/services/electricityService');
const martinosPaymentVerificationService = require('../src/services/martinosPaymentVerificationService');
const { sendElectricityPaymentReminders } = require('../src/services/electricityReminderService');
const { getTenantCommandAlias, __test: waHandlerTest } = require('../src/handlers/waHandler');
const {
  handleKosCommand,
  handlePendingConfirmation,
  handleProofUpload,
} = require('../src/commands/kos');

const realService = {
  getCurrentTenantBill: electricityService.getCurrentTenantBill,
  getOldestUnpaidTenantBill: electricityService.getOldestUnpaidTenantBill,
  getElectricitySummary: electricityService.getElectricitySummary,
  getPaidTenants: electricityService.getPaidTenants,
  getUnpaidTenants: electricityService.getUnpaidTenants,
  getExistingUnpaidTenantsForPeriod: electricityService.getExistingUnpaidTenantsForPeriod,
  getRoomByCode: electricityService.getRoomByCode,
  getElectricityBillByRoomCode: electricityService.getElectricityBillByRoomCode,
  getBillById: electricityService.getBillById,
  markElectricityPaidByTagihanId: electricityService.markElectricityPaidByTagihanId,
  markElectricityPaidByKamarId: electricityService.markElectricityPaidByKamarId,
  markElectricityPaidByRoomCode: electricityService.markElectricityPaidByRoomCode,
};

const realEnv = {
  MARTINOS_BANK_NAME: process.env.MARTINOS_BANK_NAME,
  MARTINOS_BANK_ACCOUNT: process.env.MARTINOS_BANK_ACCOUNT,
  MARTINOS_BANK_ACCOUNT_NAME: process.env.MARTINOS_BANK_ACCOUNT_NAME,
  MARTINOS_ADMIN_WA_JID: process.env.MARTINOS_ADMIN_WA_JID,
  MARTINOS_GROUP_1_JID: process.env.MARTINOS_GROUP_1_JID,
  MARTINOS_GROUP_2_JID: process.env.MARTINOS_GROUP_2_JID,
  MARTINOS_GROUP_3_JID: process.env.MARTINOS_GROUP_3_JID,
};

test.afterEach(() => {
  Object.assign(electricityService, realService);
  for (const [key, value] of Object.entries(realEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function tenant() {
  return {
    id: 'room-101',
    kamar_id: 'room-101',
    nomor_kamar: 'M1-101',
    nama_penyewa: 'Budi',
    gedung: { nama: 'Martinos 1' },
  };
}

function fakeSock() {
  const sent = [];
  return {
    sent,
    sock: {
      sendMessage: async (jid, content, options) => {
        sent.push({ jid, content, options });
        return { jid, content, options };
      },
    },
  };
}

test('WhatsApp admin and tenant menus are role-specific', async () => {
  const adminMenu = await handleKosCommand('/start', [], '628100000001@s.whatsapp.net', 'admin', null, fakeSock().sock, null);
  assert.match(adminMenu, /Halo, Bu Umi/);
  assert.match(adminMenu, /Menu Admin/);
  assert.match(adminMenu, /\/listrik/);
  assert.match(adminMenu, /\/umumkan/);

  const tenantMenu = await handleKosCommand('/start', [], '628100000002@s.whatsapp.net', 'tenant', tenant(), fakeSock().sock, null);
  assert.match(tenantMenu, /Menu Penghuni/);
  assert.match(tenantMenu, /\/bayar_listrik/);
  assert.match(tenantMenu, /\/status_bayar_info/);
});

test('WhatsApp admin and tenant cannot use each other commands', async () => {
  const adminUsingTenantCommand = await handleKosCommand(
    '/bayar_listrik',
    [],
    '628100000001@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );
  assert.match(adminUsingTenantCommand, /khusus penghuni/);

  const tenantUsingAdminCommand = await handleKosCommand(
    '/listrik',
    ['mei', '2026'],
    '628100000002@s.whatsapp.net',
    'tenant',
    tenant(),
    fakeSock().sock,
    null,
  );
  assert.match(tenantUsingAdminCommand, /khusus admin/);
});

test('WhatsApp tenant must start /bayar_listrik before choosing payment method', async () => {
  const reply = await handlePendingConfirmation(
    'cash',
    '628100000003@s.whatsapp.net',
    'tenant',
    tenant(),
    fakeSock().sock,
  );

  assert.match(reply, /sesi pembayaran/);
  assert.match(reply, /\/bayar_listrik/);
});

test('WhatsApp tenant transfer flow shows configured bank details after /bayar_listrik', async () => {
  process.env.MARTINOS_BANK_NAME = 'BCA';
  process.env.MARTINOS_BANK_ACCOUNT = '1234567890';
  process.env.MARTINOS_BANK_ACCOUNT_NAME = 'Ibu Kos';

  electricityService.getCurrentTenantBill = async () => null;

  const userId = '628100000004@s.whatsapp.net';
  const startReply = await handleKosCommand(
    '/bayar_listrik',
    [],
    userId,
    'tenant',
    tenant(),
    fakeSock().sock,
    null,
  );
  assert.match(startReply, /BAYAR LISTRIK/);
  assert.match(startReply, /\/cash/);
  assert.match(startReply, /\/transfer/);

  const transferReply = await handlePendingConfirmation(
    'transfer',
    userId,
    'tenant',
    tenant(),
    fakeSock().sock,
  );
  assert.match(transferReply, /Bank: BCA/);
  assert.match(transferReply, /No Rekening: 1234567890/);
  assert.match(transferReply, /Atas Nama: Ibu Kos/);
});


test('WhatsApp tenant already paid current month does not get new payment choices', async () => {
  electricityService.getCurrentTenantBill = async () => ({
    id: 'bill-paid-101',
    bulan: 5,
    tahun: 2026,
    status_bayar: 'Lunas',
    metode_bayar: 'Transfer Bank',
    tanggal_bayar: '2026-05-18',
  });
  const userId = '628100000008@s.whatsapp.net';
  const reply = await handleKosCommand(
    '/bayar_listrik',
    [],
    userId,
    'tenant',
    tenant(),
    fakeSock().sock,
    null,
  );

  assert.match(reply, /Sampun lunas/);
  assert.match(reply, /Transfer Bank/);
  assert.match(reply, /Ora perlu kirim bukti maneh/);
  assert.doesNotMatch(reply, /Ketik \/cash/);
  assert.doesNotMatch(reply, /Ketik \/transfer/);

  const followUp = await handlePendingConfirmation(
    'transfer',
    userId,
    'tenant',
    tenant(),
    fakeSock().sock,
  );
  assert.match(followUp, /sesi pembayaran/);
  assert.match(followUp, /\/bayar_listrik/);
});

test('WhatsApp tenant starts current month payment without creating an unpaid row', async () => {
  electricityService.getCurrentTenantBill = async () => null;

  const reply = await handleKosCommand(
    '/bayar_listrik',
    [],
    '628100000009@s.whatsapp.net',
    'tenant',
    tenant(),
    fakeSock().sock,
    null,
  );

  assert.match(reply, /MEI 2026/);
  assert.match(reply, /Belum bayar|Telat bayar/);
  assert.match(reply, /\/cash/);
  assert.match(reply, /\/transfer/);
});

test('WhatsApp tenant with an old Belum Bayar row still sees current month unpaid status', async () => {
  electricityService.getCurrentTenantBill = async () => ({
    id: 'bill-may-old-unpaid-row',
    bulan: 5,
    tahun: 2026,
    status_bayar: 'Belum Bayar',
  });

  const reply = await handleKosCommand(
    '/bayar_listrik',
    [],
    '628100000010@s.whatsapp.net',
    'tenant',
    tenant(),
    fakeSock().sock,
    null,
  );

  assert.match(reply, /MEI 2026/);
  assert.match(reply, /Belum bayar|Telat bayar/);
});
test('WhatsApp proof image before payment method is rejected without forwarding to admin', async () => {
  const { sock, sent } = fakeSock();
  const msg = {
    key: { remoteJid: '628100000005@s.whatsapp.net' },
    message: { imageMessage: { mimetype: 'image/jpeg' } },
  };

  const handled = await handleProofUpload(msg, '628100000005@s.whatsapp.net', tenant(), sock);

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, '628100000005@s.whatsapp.net');
  assert.match(sent[0].content.text, /sesi pembayaran/);
  assert.match(sent[0].content.text, /\/bayar_listrik/);
  assert.match(sent[0].content.text, /\/cash|\/transfer/);
});

test('WhatsApp admin manual mark-paid flow waits for YA BAYAR before database update', async () => {
  let updateCalls = 0;
  electricityService.getRoomByCode = async (roomCode) => ({
    room: { id: 'room-101' },
    roomCode,
    tenantName: 'Budi',
    buildingName: 'Martinos 1',
  });
  electricityService.getCurrentTenantBill = async () => ({
    id: 'bill-manual-101',
    status_bayar: 'Belum Bayar',
  });
  electricityService.markElectricityPaidByRoomCode = async (roomCode, bulan, tahun, method) => {
    updateCalls += 1;
    return {
      roomCode,
      tenantName: 'Budi',
      buildingName: 'Martinos 1',
      periodLabel: `${bulan} ${tahun}`,
      method,
    };
  };

  const userId = '628100000006@s.whatsapp.net';
  const prompt = await handleKosCommand(
    '/lunas_listrik',
    ['M1-101', 'mei', '2026', 'cash'],
    userId,
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.match(prompt, /YA BAYAR/);
  assert.match(prompt, /Penghuni: \*Budi\*/);
  assert.match(prompt, /Gedung: \*Martinos 1\*/);
  assert.match(prompt, /BATAL BAYAR/);
  assert.equal(updateCalls, 0);

  const result = await handlePendingConfirmation('YA BAYAR', userId, 'admin', null, fakeSock().sock);
  assert.match(result, /berhasil dicatat lunas/);
  assert.match(result, /Penghuni: \*Budi\*/);
  assert.equal(updateCalls, 1);
});

test('WhatsApp admin pending announcement blocks other admin commands until resolved', async () => {
  process.env.MARTINOS_GROUP_1_JID = '120363000000000001@g.us';

  const userId = '628100000013@s.whatsapp.net';
  const prompt = await handleKosCommand(
    '/umumkan',
    ['martinos1', 'Air', 'mati'],
    userId,
    'admin',
    null,
    fakeSock().sock,
    null,
  );
  assert.match(prompt, /Konfirmasi Pengumuman/);

  const blocked = await handlePendingConfirmation(
    '/listrik mei 2026',
    userId,
    'admin',
    null,
    fakeSock().sock,
  );
  assert.match(blocked, /dereng rampung/);
  assert.match(blocked, /KIRIM PENGUMUMAN/);
  assert.match(blocked, /BATAL PENGUMUMAN/);

  const cancelled = await handlePendingConfirmation(
    'BATAL PENGUMUMAN',
    userId,
    'admin',
    null,
    fakeSock().sock,
  );
  assert.match(cancelled, /dibatalkan/);
});

test('WhatsApp admin pending manual mark-paid blocks other admin commands until resolved', async () => {
  electricityService.getRoomByCode = async (roomCode) => ({
    room: { id: 'room-101' },
    roomCode,
    tenantName: 'Budi',
    buildingName: 'Martinos 1',
  });
  electricityService.getCurrentTenantBill = async () => ({
    id: 'bill-manual-102',
    status_bayar: 'Belum Bayar',
  });

  const userId = '628100000014@s.whatsapp.net';
  const prompt = await handleKosCommand(
    '/lunas_listrik',
    ['M1-101', 'mei', '2026', 'cash'],
    userId,
    'admin',
    null,
    fakeSock().sock,
    null,
  );
  assert.match(prompt, /YA BAYAR/);

  const blocked = await handlePendingConfirmation(
    '/umumkan martinos1 test',
    userId,
    'admin',
    null,
    fakeSock().sock,
  );
  assert.match(blocked, /dereng rampung/);
  assert.match(blocked, /YA BAYAR/);
  assert.match(blocked, /BATAL BAYAR/);

  const cancelled = await handlePendingConfirmation(
    'BATAL BAYAR',
    userId,
    'admin',
    null,
    fakeSock().sock,
  );
  assert.match(cancelled, /dibatalkan/);
});

test('WhatsApp admin sudah_listrik lists paid tenants and supports dash alias', async () => {
  electricityService.getPaidTenants = async (bulan, tahun) => ({
    periodLabel: `${electricityService.getMonthName(electricityService.parseMonth(bulan))} ${tahun}`,
    tenants: [
      {
        nomor_kamar: 'M1-101',
        nama_penyewa: 'Budi',
        gedung: { nama: 'Martinos 1' },
        paymentMethod: 'Tunai',
        paidAt: '2026-05-10',
      },
    ],
  });

  const underscoreReply = await handleKosCommand(
    '/sudah_listrik',
    ['mei', '2026'],
    '628100000015@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.match(underscoreReply, /SUDAH BAYAR LISTRIK MEI 2026/);
  assert.match(underscoreReply, /M1-101/);
  assert.match(underscoreReply, /Budi/);
  assert.match(underscoreReply, /Tunai/);

  const dashReply = await handleKosCommand(
    '/sudah-listrik',
    ['mei', '2026'],
    '628100000015@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.match(dashReply, /SUDAH BAYAR LISTRIK MEI 2026/);
});

test('WhatsApp admin listrik summary uses occupied rooms minus paid rows', async () => {
  electricityService.getElectricitySummary = async () => ({
    periodLabel: 'Mei 2026',
    amountPerPerson: 55000,
    buildings: [
      {
        name: 'Martinos 1',
        paid: 5,
        unpaid: 7,
        total: 12,
      },
    ],
    totalTenants: 12,
    totalPaid: 5,
    totalUnpaid: 7,
  });

  const reply = await handleKosCommand(
    '/listrik',
    ['mei', '2026'],
    '628100000015@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.match(reply, /Total tagihan: \*12\*/);
  assert.match(reply, /Lunas: \*5\*/);
  assert.match(reply, /Belum lunas: \*7\*/);
  assert.match(reply, /Martinos 1\*: 5 lunas, 7 belum \(12 total\)/);
});

test('WhatsApp admin manual mark-paid can create missing paid bill after confirmation', async () => {
  electricityService.getRoomByCode = async (roomCode) => ({
    room: { id: 'room-101' },
    roomCode,
    tenantName: 'Budi',
    buildingName: 'Martinos 1',
  });
  electricityService.getCurrentTenantBill = async () => null;
  electricityService.markElectricityPaidByRoomCode = async (roomCode, bulan, tahun, method) => ({
    roomCode,
    tenantName: 'Budi',
    buildingName: 'Martinos 1',
    periodLabel: `${electricityService.getMonthName(electricityService.parseMonth(bulan))} ${tahun}`,
    method,
    created: true,
  });

  const userId = '628100000016@s.whatsapp.net';
  const prompt = await handleKosCommand(
    '/lunas_listrik',
    ['M1-101', 'mei', '2026', 'cash'],
    userId,
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.match(prompt, /tagihan periode iki durung ana/);
  assert.match(prompt, /YA BAYAR/);

  const result = await handlePendingConfirmation('YA BAYAR', userId, 'admin', null, fakeSock().sock);
  assert.match(result, /berhasil dicatat lunas/);
  assert.match(result, /tagihan durung ana/);
});

test('10th-day reminder sends occupied tenants without paid rows and does not create bills', async () => {
  electricityService.getExistingUnpaidTenantsForPeriod = async (bulan, tahun) => ({
    periodLabel: `${electricityService.getMonthName(bulan)} ${tahun}`,
    tenants: [
      {
        tagihanId: 'bill-1',
        roomCode: 'M1-101',
        tenantName: 'Budi',
        tenantPhone: '08123456789',
        buildingName: 'Martinos 1',
      },
      {
        tagihanId: 'bill-2',
        roomCode: 'M1-102',
        tenantName: 'No Phone',
        tenantPhone: '',
        buildingName: 'Martinos 1',
      },
    ],
  });

  const { sock, sent } = fakeSock();
  const result = await sendElectricityPaymentReminders(sock, { bulan: 5, tahun: 2026 });

  assert.equal(result.totalCount, 2);
  assert.equal(result.sentCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].jid, '628123456789@s.whatsapp.net');
  assert.match(sent[0].content.text, /Mei 2026/);
  assert.match(sent[0].content.text, /\/bayar_listrik/);
});

test('WhatsApp announcement confirmation displays target label and group count', async () => {
  process.env.MARTINOS_GROUP_1_JID = '120363000000000001@g.us';

  const prompt = await handleKosCommand(
    '/umumkan',
    ['martinos1', 'Air', 'mati', 'jam', '10'],
    '628100000011@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.match(prompt, /Target: \*Martinos 1\*/);
  assert.match(prompt, /Martinos 1: siap/);
  assert.match(prompt, /Jumlah grup sing bakal dikirim: \*1\*/);
});

test('WhatsApp announcement to all shows configured and missing groups', async () => {
  process.env.MARTINOS_GROUP_1_JID = '120363000000000001@g.us';
  process.env.MARTINOS_GROUP_2_JID = '120363000000000002@g.us';
  delete process.env.MARTINOS_GROUP_3_JID;

  const prompt = await handleKosCommand(
    '/umumkan',
    ['semua', 'Air', 'mati', 'jam', '10'],
    '628100000015@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.match(prompt, /Target: \*Semua Martinos\*/);
  assert.match(prompt, /Martinos 1: siap/);
  assert.match(prompt, /Martinos 2: siap/);
  assert.match(prompt, /Martinos 3: belum disetel/);
  assert.match(prompt, /Jumlah grup sing bakal dikirim: \*2\*/);
});

test('fuzzy tenant aliases map to deterministic commands without AI', () => {
  assert.equal(getTenantCommandAlias('bayar listrik'), '/bayar_listrik');
  assert.equal(getTenantCommandAlias('mau bayar'), '/bayar_listrik');
  assert.equal(getTenantCommandAlias('cek listrik'), '/status_bayar_info');
  assert.equal(getTenantCommandAlias('status bayar'), '/status_bayar_info');
  assert.equal(getTenantCommandAlias('cerita bebas'), '');
});

test('deprecated utility commands return Martinos-only unavailable replies', () => {
  for (const command of [
    '/model_info',
    '/switch',
    '/ai_usage',
    '/donate',
    '/download',
    '/pdf',
    '/img',
    '/tosticker',
    '/saldo',
    '/cuaca',
    '/sholat',
  ]) {
    const reply = waHandlerTest.getUnavailableCommandReply(command);
    assert.match(reply, /Martinos Kos/);
    assert.match(reply, /Fitur iki ora tersedia/);
    assert.doesNotMatch(reply, /model|token|RPM|donasi/i);
  }
});

test('role-aware AI prompt hides model and legacy feature details from users', () => {
  const adminPrompt = waHandlerTest.buildRoleAwareAiPrompt('model apa?', 'admin', null);
  assert.match(adminPrompt, /You are Ajeng/);
  assert.match(adminPrompt, /admin as Bu Umi/);
  assert.match(adminPrompt, /Kula Ajeng/);
  assert.match(adminPrompt, /Do not mention AI model names/);
  assert.match(adminPrompt, /old bot branding/);
  assert.match(adminPrompt, /old chat platforms/);

  const tenantPrompt = waHandlerTest.buildRoleAwareAiPrompt('aku mau download pdf', 'tenant', tenant());
  assert.match(tenantPrompt, /You are Ajeng/);
  assert.match(tenantPrompt, /Do not mention AI model names/);
  assert.match(tenantPrompt, /\/bayar_listrik/);
  assert.doesNotMatch(`${adminPrompt}\n${tenantPrompt}`, /Bu Sri/);
});

test('stale proof approval does not update an already paid bill', async () => {
  let updateCalls = 0;
  electricityService.getBillById = async () => ({
    id: 'bill-paid-stale',
    status_bayar: 'Lunas',
    metode_bayar: 'Transfer Bank',
  });
  electricityService.markElectricityPaidByTagihanId = async () => {
    updateCalls += 1;
    return {};
  };

  martinosPaymentVerificationService.registerMartinosProofVerification('BUKTI-9501', {
    tenantName: 'Budi',
    tenantWhatsappJid: 'local-test@s.whatsapp.net',
    roomCode: 'M1-101',
    tagihanId: 'bill-paid-stale',
    metodeBayar: 'cash',
    tenant: tenant(),
    bulan: 'Mei',
    tahun: 2026,
  });

  const reply = await handleKosCommand(
    '/terima_bukti',
    ['BUKTI-9501'],
    '628100000012@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );

  assert.equal(updateCalls, 0);
  assert.match(reply, /Tagihan sudah lunas/);
  assert.equal(martinosPaymentVerificationService.getMartinosProofVerification('9501'), null);
});

test('WhatsApp unknown proof code is safe for accept and reject commands', async () => {
  martinosPaymentVerificationService.clearMartinosProofVerification('BUKTI-NOTFOUND');

  const acceptReply = await handleKosCommand(
    '/terima_bukti',
    ['BUKTI-NOTFOUND'],
    '628100000007@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );
  assert.match(acceptReply, /ora ketemu|kedaluwarsa/);
  assert.match(acceptReply, /24 jam/);

  const rejectReply = await handleKosCommand(
    '/tolak_bukti',
    ['BUKTI-NOTFOUND', 'blur'],
    '628100000007@s.whatsapp.net',
    'admin',
    null,
    fakeSock().sock,
    null,
  );
  assert.match(rejectReply, /ora ketemu|kedaluwarsa/);
  assert.match(rejectReply, /24 jam/);
});
