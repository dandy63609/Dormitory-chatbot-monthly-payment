const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { normalizePhone, isAdminIdentifier } = require('../src/services/tenantService');
const electricityService = require('../src/services/electricityService');
const supabase = require('../src/lib/supabaseClient');

const realSupabaseFrom = supabase.from;
const realAdminWaNumbers = process.env.ADMIN_WA_NUMBERS;
const realAdminWaJids = process.env.ADMIN_WA_JIDS;

test.afterEach(() => {
  supabase.from = realSupabaseFrom;
  if (realAdminWaNumbers === undefined) delete process.env.ADMIN_WA_NUMBERS;
  else process.env.ADMIN_WA_NUMBERS = realAdminWaNumbers;
  if (realAdminWaJids === undefined) delete process.env.ADMIN_WA_JIDS;
  else process.env.ADMIN_WA_JIDS = realAdminWaJids;
});

test('normalizePhone returns canonical Indonesian WhatsApp numbers', () => {
  assert.equal(normalizePhone('08123456789'), '628123456789');
  assert.equal(normalizePhone('8123456789'), '628123456789');
  assert.equal(normalizePhone('628123456789@s.whatsapp.net'), '628123456789');
  assert.equal(normalizePhone('628123456789:12@s.whatsapp.net'), '628123456789');
  assert.equal(normalizePhone(''), '');
});

test('isAdminIdentifier accepts configured phone numbers and raw WhatsApp JIDs', () => {
  process.env.ADMIN_WA_NUMBERS = '628123456789';
  process.env.ADMIN_WA_JIDS = '999888777@lid,628987654321@s.whatsapp.net';

  assert.equal(isAdminIdentifier('08123456789@s.whatsapp.net'), true);
  assert.equal(isAdminIdentifier('999888777@lid'), true);
  assert.equal(isAdminIdentifier('628987654321@s.whatsapp.net'), true);
  assert.equal(isAdminIdentifier('111222333@lid'), false);
});

test('electricity month parsing accepts Indonesian names and numbers', () => {
  assert.equal(electricityService.parseMonth('mei'), 5);
  assert.equal(electricityService.parseMonth('12'), 12);
  assert.equal(electricityService.parseMonthToNumber('tidak-valid'), null);
  assert.throws(
    () => electricityService.parseMonth('13'),
    /Format bulan tidak dikenali/,
  );
});

test('tagihan_listrik metode_bayar maps to Supabase CHECK values', () => {
  assert.equal(electricityService.normalizeTagihanMetodeBayarForDb('CASH'), 'Tunai');
  assert.equal(electricityService.normalizeTagihanMetodeBayarForDb('TUNAI'), 'Tunai');
  assert.equal(electricityService.normalizeTagihanMetodeBayarForDb('TRANSFER'), 'Transfer Bank');
  assert.equal(
    electricityService.normalizeTagihanMetodeBayarForDb('TRANSFER BANK'),
    'Transfer Bank',
  );
  assert.equal(electricityService.normalizeTagihanMetodeBayarForDb('Tunai'), 'Tunai');
  assert.equal(
    electricityService.normalizeTagihanMetodeBayarForDb('Transfer Bank'),
    'Transfer Bank',
  );
  assert.equal(electricityService.normalizeTagihanMetodeBayarForDb(''), null);
  assert.throws(
    () => electricityService.normalizeTagihanMetodeBayarForDb('crypto'),
    /Metode bayar tidak dikenali/,
  );
});

test('getPaidTenants only returns occupied rooms with paid electricity rows', async () => {
  supabase.from = (table) => {
    const query = {
      filters: [],
      select() {
        return this;
      },
      eq(column, value) {
        this.filters.push({ column, value });
        return this;
      },
      then(resolve, reject) {
        let result;

        if (table === 'kamar') {
          result = {
            data: [
              {
                id: 1,
                gedung_id: 10,
                nomor_kamar: 'M1-101',
                nama_penyewa: 'Budi',
                hp_penyewa: '628111',
                status_kamar: 'Terisi',
                gedung: { id: 10, nama: 'Martinos 1' },
              },
              {
                id: 2,
                gedung_id: 10,
                nomor_kamar: 'M1-102',
                nama_penyewa: 'Andi',
                hp_penyewa: '628222',
                status_kamar: 'Terisi',
                gedung: { id: 10, nama: 'Martinos 1' },
              },
            ],
            error: null,
          };
        } else if (table === 'tagihan_listrik') {
          result = {
            data: [
              {
                id: 201,
                kamar_id: 1,
                bulan: 5,
                tahun: 2026,
                status_bayar: 'Lunas',
                metode_bayar: 'Tunai',
                tanggal_bayar: '2026-05-10',
                kamar: {
                  id: 1,
                  nomor_kamar: 'M1-101',
                  nama_penyewa: 'Budi',
                  gedung: { id: 10, nama: 'Martinos 1' },
                },
              },
              {
                id: 202,
                kamar_id: 99,
                bulan: 5,
                tahun: 2026,
                status_bayar: 'Lunas',
                metode_bayar: 'Transfer Bank',
                tanggal_bayar: '2026-05-11',
                kamar: {
                  id: 99,
                  nomor_kamar: 'OLD-ROOM',
                  nama_penyewa: 'Old Tenant',
                  gedung: { id: 10, nama: 'Martinos 1' },
                },
              },
            ],
            error: null,
          };
        } else {
          result = { data: [], error: null };
        }

        return Promise.resolve(result).then(resolve, reject);
      },
    };

    return query;
  };

  const result = await electricityService.getPaidTenants('mei', '2026');

  assert.deepEqual(
    result.tenants.map((tenant) => tenant.roomCode),
    ['M1-101'],
  );
  assert.equal(result.tenants[0].paymentMethod, 'Tunai');
  assert.equal(result.tenants[0].paidAt, '2026-05-10');
});
