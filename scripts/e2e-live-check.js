#!/usr/bin/env node
'use strict';

const { createClient } = require('@supabase/supabase-js');

const REQUIRED_ENV = [
  'SUPABASE_URL',
  'E2E_TEST_TENANT_PHONE',
];

const SUPABASE_KEY_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY',
];

const KAMAR_TABLE = 'kamar';
const TAGIHAN_TABLE = 'tagihan_listrik';
const OCCUPIED_STATUS = 'Terisi';
const PAID_STATUS = 'lunas';
const DEFAULT_ELECTRICITY_NOMINAL = 55000;

const results = [];

function isEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function addResult(status, label, detail) {
  results.push({ status, label, detail });
  const suffix = detail ? ` - ${detail}` : '';
  console.log(`${status} ${label}${suffix}`);
}

function pass(label, detail) {
  addResult('PASS', label, detail);
}

function fail(label, detail) {
  addResult('FAIL', label, detail);
}

function warn(label, detail) {
  addResult('WARN', label, detail);
}

function envStatus(name) {
  const value = process.env[name];
  if (value === undefined) return 'missing';
  if (String(value).trim() === '') return 'empty';
  return 'set: ****';
}

function validateEnv() {
  console.log('\nEnvironment checks');

  let valid = true;
  for (const name of REQUIRED_ENV) {
    const status = envStatus(name);
    if (status === 'missing' || status === 'empty') {
      fail(`env ${name}`, status);
      valid = false;
    } else {
      pass(`env ${name}`, status);
    }
  }

  const keyName = SUPABASE_KEY_ENV_NAMES.find((name) => {
    const value = process.env[name];
    return value !== undefined && String(value).trim() !== '';
  });

  for (const name of SUPABASE_KEY_ENV_NAMES) {
    const status = envStatus(name);
    if (name === keyName) {
      pass(`env ${name}`, status);
    } else if (status === 'set: ****') {
      warn(`env ${name}`, 'set but not selected');
    } else {
      warn(`env ${name}`, status);
    }
  }

  if (!keyName) {
    fail('Supabase key env', `one of ${SUPABASE_KEY_ENV_NAMES.join(', ')} must be set`);
    valid = false;
  }

  const allowWrites = isEnabled(process.env.E2E_ALLOW_WRITES);
  pass('write guard', allowWrites ? 'E2E_ALLOW_WRITES=true' : 'read-only mode');

  return {
    valid,
    keyName,
    allowWrites,
  };
}

function normalizePhone(rawValue) {
  const digits = String(rawValue || '')
    .trim()
    .split('@')[0]
    .split(':')[0]
    .replace(/[^\d]/g, '');

  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return 'empty';
  if (normalized.length <= 4) return '****';
  return `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
}

function currentPeriod() {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

function getMonthName(monthNumber) {
  return [
    null,
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ][monthNumber] || String(monthNumber);
}

function formatRupiah(value) {
  return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

function getNominal() {
  const amount = Number.parseInt(
    process.env.MARTINOS_LISTRIK_NOMINAL || String(DEFAULT_ELECTRICITY_NOMINAL),
    10,
  );
  return Number.isFinite(amount) && amount > 0 ? amount : DEFAULT_ELECTRICITY_NOMINAL;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('id-ID');
}

function getPaymentStatusLabel(bill) {
  if (String(bill?.status_bayar || '').trim().toLowerCase() === PAID_STATUS) {
    return 'Sampun lunas';
  }

  return new Date().getDate() > 5 ? 'Telat bayar' : 'Belum bayar';
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
  if (String(buildingName).toLowerCase().includes('martinos')) return buildingName;
  return `Martinos ${buildingName}`;
}

function buildBayarListrikPreview(tenant, bill, period) {
  return [
    `> *BAYAR LISTRIK ${getMonthName(period.month).toUpperCase()} ${period.year}*`,
    '',
    `Nggih ${getTenantMasName(tenant)}`,
    `Kamar: ${getTenantRoomCode(tenant)}`,
    `Gedung: ${getTenantBuildingLabel(tenant)}`,
    `Total tagihan: ${formatRupiah(getNominal())}`,
    `Status: ${getPaymentStatusLabel(bill)}`,
    '',
    'Metode pembayaran badhe apa, Mas?',
    'Ketik /cash nek bayar tunai.',
    'Ketik /transfer nek bayar transfer.',
  ].join('\n');
}

function buildCekBayarListrikPreview(tenant, bill, period) {
  const lines = [
    `> *STATUS BAYAR LISTRIK ${getMonthName(period.month).toUpperCase()} ${period.year}*`,
    '',
    `Nggih, ${getTenantMasName(tenant)}.`,
    `Kamar: *${getTenantRoomCode(tenant)}*`,
    `Periode: *${getMonthName(period.month)} ${period.year}*`,
    `Nominal: *${formatRupiah(getNominal())}*`,
    `Status: *${getPaymentStatusLabel(bill)}*`,
  ];

  if (bill?.metode_bayar) lines.push(`Metode: *${bill.metode_bayar}*`);
  if (bill?.tanggal_bayar) lines.push(`Tanggal bayar: *${formatDate(bill.tanggal_bayar)}*`);

  return lines.join('\n');
}

async function checkConnection(supabase) {
  const { error } = await supabase.from(KAMAR_TABLE).select('id', { count: 'exact', head: true });
  if (error) throw error;
}

async function findTenant(supabase, rawPhone) {
  const normalized = normalizePhone(rawPhone);
  const { data, error } = await supabase
    .from(KAMAR_TABLE)
    .select(`
      id,
      gedung_id,
      nomor_kamar,
      nama_penyewa,
      hp_penyewa,
      status_kamar,
      gedung:gedung_id (
        id,
        nama
      )
    `)
    .eq('status_kamar', OCCUPIED_STATUS)
    .not('hp_penyewa', 'is', null);

  if (error) throw error;

  return (data || []).find((row) => normalizePhone(row.hp_penyewa) === normalized) || null;
}

async function findCurrentBill(supabase, tenant, period) {
  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .eq('kamar_id', tenant.id)
    .eq('bulan', period.month)
    .eq('tahun', period.year)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function createCurrentBill(supabase, tenant, period) {
  const { data, error } = await supabase
    .from(TAGIHAN_TABLE)
    .insert({
      kamar_id: tenant.id,
      bulan: period.month,
      tahun: period.year,
      status_bayar: 'belum_bayar',
      metode_bayar: null,
      tanggal_bayar: null,
    })
    .select('id, kamar_id, bulan, tahun, status_bayar, metode_bayar, tanggal_bayar')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Supabase insert returned no tagihan_listrik row.');
  return data;
}

async function main() {
  console.log('Martinos Kos Bot live E2E service check');
  console.log('No .env file is loaded by this script. Env values are never printed.');

  const env = validateEnv();
  if (!env.valid) {
    console.log('\nOverall: FAIL');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env[env.keyName];
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  console.log('\nSupabase checks');
  try {
    await checkConnection(supabase);
    pass('Supabase connection', 'kamar table is reachable');
  } catch (error) {
    fail('Supabase connection', error.message);
    console.log('\nOverall: FAIL');
    process.exit(1);
  }

  const maskedPhone = maskPhone(process.env.E2E_TEST_TENANT_PHONE);
  let tenant;
  try {
    tenant = await findTenant(supabase, process.env.E2E_TEST_TENANT_PHONE);
    if (!tenant) {
      fail('test tenant lookup', `no occupied kamar row matched phone ${maskedPhone}`);
      console.log('\nOverall: FAIL');
      process.exit(1);
    }
    pass('test tenant lookup', `matched phone ${maskedPhone}`);
  } catch (error) {
    fail('test tenant lookup', error.message);
    console.log('\nOverall: FAIL');
    process.exit(1);
  }

  const period = currentPeriod();
  let bill;
  try {
    bill = await findCurrentBill(supabase, tenant, period);
    if (bill) {
      pass('current month tagihan_listrik', `${getMonthName(period.month)} ${period.year} row exists`);
    } else if (env.allowWrites) {
      warn('current month tagihan_listrik', 'missing; E2E_ALLOW_WRITES=true so creating unpaid row');
      bill = await createCurrentBill(supabase, tenant, period);
      pass('current month tagihan_listrik', `${getMonthName(period.month)} ${period.year} row created`);
    } else {
      fail(
        'current month tagihan_listrik',
        `missing for ${getMonthName(period.month)} ${period.year}; /bayar_listrik would try to create it`,
      );
      console.log('\nOverall: FAIL');
      process.exit(1);
    }
  } catch (error) {
    fail('current month tagihan_listrik', error.message);
    console.log('\nOverall: FAIL');
    process.exit(1);
  }

  console.log('\nTenant service-flow simulation');
  try {
    const bayarPreview = buildBayarListrikPreview(tenant, bill, period);
    if (!bayarPreview.includes('/cash') || !bayarPreview.includes('/transfer')) {
      throw new Error('/bayar_listrik preview did not include payment method choices.');
    }
    pass('/bayar_listrik service flow', 'bill can be read and payment menu can be built without WhatsApp sends');

    const cekPreview = buildCekBayarListrikPreview(tenant, bill, period);
    if (!cekPreview.includes('STATUS BAYAR LISTRIK')) {
      throw new Error('/cek_bayar_listrik preview did not include status header.');
    }
    pass('/cek_bayar_listrik service flow', 'current bill status can be built without WhatsApp sends');

    console.log('\nMasked preview summary');
    console.log(`Tenant phone: ${maskedPhone}`);
    console.log(`Room code present: ${getTenantRoomCode(tenant) !== '-' ? 'yes' : 'no'}`);
    console.log(`Bill status: ${getPaymentStatusLabel(bill)}`);
  } catch (error) {
    fail('tenant service-flow simulation', error.message);
    console.log('\nOverall: FAIL');
    process.exit(1);
  }

  const hasFailure = results.some((result) => result.status === 'FAIL');
  console.log(`\nOverall: ${hasFailure ? 'FAIL' : 'PASS'}`);
  process.exit(hasFailure ? 1 : 0);
}

main().catch((error) => {
  fail('unexpected script error', error.message);
  console.log('\nOverall: FAIL');
  process.exit(1);
});
