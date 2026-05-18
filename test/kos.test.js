const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  handleKosCommand,
  handlePendingConfirmation,
} = require('../src/commands/kos');

test('/umumkan waits for explicit confirmation before sending', async () => {
  process.env.MARTINOS_GROUP_1_JID = '120363000000000001@g.us';

  const sentMessages = [];
  const sock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { jid, content };
    },
  };

  const userId = '628123450001@s.whatsapp.net';
  const prompt = await handleKosCommand(
    '/umumkan',
    ['martinos1', 'Air', 'mati', 'jam', '10'],
    userId,
    'admin',
    null,
    sock,
    null,
  );

  assert.match(prompt, /Konfirmasi Pengumuman/);
  assert.match(prompt, /KIRIM PENGUMUMAN/);
  assert.equal(sentMessages.length, 0);

  const result = await handlePendingConfirmation(
    'KIRIM PENGUMUMAN',
    userId,
    'admin',
    null,
    sock,
  );

  assert.match(result, /Pengumuman terkirim/);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].jid, process.env.MARTINOS_GROUP_1_JID);
  assert.match(sentMessages[0].content.text, /Air mati jam 10/);
});

test('/umumkan can be cancelled before sending', async () => {
  const sentMessages = [];
  const sock = {
    sendMessage: async (jid, content) => {
      sentMessages.push({ jid, content });
      return { jid, content };
    },
  };

  const userId = '628123450002@s.whatsapp.net';
  await handleKosCommand(
    '/umumkan',
    ['martinos1', 'Jangan', 'dikirim'],
    userId,
    'admin',
    null,
    sock,
    null,
  );

  const result = await handlePendingConfirmation(
    'BATAL PENGUMUMAN',
    userId,
    'admin',
    null,
    sock,
  );

  assert.match(result, /dibatalkan/);
  assert.equal(sentMessages.length, 0);
});

