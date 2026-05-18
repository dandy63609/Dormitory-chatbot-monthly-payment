const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { normalizePhone } = require('../src/services/tenantService');
const electricityService = require('../src/services/electricityService');
const weatherService = require('../src/services/weatherService');

test('normalizePhone returns canonical Indonesian WhatsApp numbers', () => {
  assert.equal(normalizePhone('08123456789'), '628123456789');
  assert.equal(normalizePhone('8123456789'), '628123456789');
  assert.equal(normalizePhone('628123456789@s.whatsapp.net'), '628123456789');
  assert.equal(normalizePhone('628123456789:12@s.whatsapp.net'), '628123456789');
  assert.equal(normalizePhone(''), '');
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

test('weather service reports missing API key without network access', async () => {
  const previousOpenWeatherKey = process.env.OPENWEATHER_API_KEY;
  const previousWeatherKey = process.env.WEATHER_API_KEY;
  delete process.env.OPENWEATHER_API_KEY;
  delete process.env.WEATHER_API_KEY;

  try {
    const result = await weatherService.getCuaca('Jakarta');
    assert.match(result, /API key OpenWeather tidak ditemukan/);
  } finally {
    if (previousOpenWeatherKey === undefined) delete process.env.OPENWEATHER_API_KEY;
    else process.env.OPENWEATHER_API_KEY = previousOpenWeatherKey;

    if (previousWeatherKey === undefined) delete process.env.WEATHER_API_KEY;
    else process.env.WEATHER_API_KEY = previousWeatherKey;
  }
});
