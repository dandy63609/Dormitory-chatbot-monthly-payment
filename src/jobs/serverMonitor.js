const cron = require('node-cron');
const { checkWebsites, formatMonitorMessage } = require('../services/monitorService');
const { sendElectricityPaymentReminders } = require('../services/electricityReminderService');

const MONITOR_CRON_EXPRESSION = '0 6 * * *';
const ELECTRICITY_REMINDER_CRON_EXPRESSION = '0 8 10 * *';
const URGENT_ALERT_HEADER = '> URGENT: SERVER DOWN ALERT!';

function parseCommaSeparatedList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeWhatsAppTarget(adminNumber) {
  const rawValue = String(adminNumber || '').trim();
  if (!rawValue) {
    return '';
  }

  if (rawValue.includes('@')) {
    return rawValue;
  }

  const digits = rawValue.replace(/[^\d]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function resolveWaSocket(waSocket) {
  return typeof waSocket === 'function' ? waSocket() : waSocket;
}

async function sendWhatsAppAlerts(waSocket, adminNumbers, message) {
  if (!waSocket || typeof waSocket.sendMessage !== 'function') {
    return;
  }

  for (const adminNumber of adminNumbers) {
    const target = normalizeWhatsAppTarget(adminNumber);

    if (!target) {
      continue;
    }

    try {
      await waSocket.sendMessage(target, { text: message });
    } catch (error) {
      console.error(`Gagal mengirim alert monitor ke WhatsApp admin ${adminNumber}:`, error.message || error);
    }
  }
}

function startCronJobs(waSocket) {
  const monitorTask = cron.schedule(MONITOR_CRON_EXPRESSION, async () => {
    try {
      const { results, hasError } = await checkWebsites();

      if (!hasError) {
        return;
      }

      const alertMessage = formatMonitorMessage(results, URGENT_ALERT_HEADER, 'whatsapp');
      const adminWaNumbers = parseCommaSeparatedList(process.env.ADMIN_WA_NUMBERS);
      const currentWaSocket = resolveWaSocket(waSocket);

      await sendWhatsAppAlerts(currentWaSocket, adminWaNumbers, alertMessage);
    } catch (error) {
      console.error('Error saat menjalankan cron monitor server:', error.message || error);
    }
  });

  const electricityReminderTask = cron.schedule(ELECTRICITY_REMINDER_CRON_EXPRESSION, async () => {
    try {
      const currentWaSocket = resolveWaSocket(waSocket);
      const result = await sendElectricityPaymentReminders(currentWaSocket);
      console.log(
        `Reminder listrik ${result.periodLabel}: terkirim ${result.sentCount}/${result.totalCount}, skip ${result.skippedCount}`,
      );
    } catch (error) {
      console.error('Error saat menjalankan reminder listrik:', error.message || error);
    }
  });

  console.log(`Cron monitor server aktif dengan jadwal ${MONITOR_CRON_EXPRESSION}`);
  console.log(`Cron reminder listrik aktif dengan jadwal ${ELECTRICITY_REMINDER_CRON_EXPRESSION}`);

  return {
    stop() {
      monitorTask.stop();
      electricityReminderTask.stop();
    },
  };
}

module.exports = {
  startCronJobs,
  ELECTRICITY_REMINDER_CRON_EXPRESSION,
};
