// Main entry point
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;

function shouldSuppressConsoleOutput(args) {
    return typeof args[0] === 'string' && args[0].startsWith('Closing session');
}

console.log = (...args) => {
    if (shouldSuppressConsoleOutput(args)) {
        return;
    }
    originalConsoleLog(...args);
};

console.info = (...args) => {
    if (shouldSuppressConsoleOutput(args)) {
        return;
    }
    originalConsoleInfo(...args);
};

require('dotenv').config(); // Load environment variables from .env file

// Log untuk memastikan environment variable terbaca (opsional)
const openRouterModel =
    String(process.env.AI_MODEL || '').trim()
    || String(process.env.OPENROUTER_MODEL || '').trim()
    || 'openai/gpt-oss-120b';
const paidOpenRouterModelsAllowed = process.env.ALLOW_PAID_OPENROUTER_MODELS === 'true';

console.log('AI provider: openrouter');
console.log(`OpenRouter model: ${openRouterModel}`);
console.log(`Paid OpenRouter models allowed: ${paidOpenRouterModelsAllowed}`);

if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  Peringatan: OPENROUTER_API_KEY tidak ditemukan di environment variables.');
    console.warn('   Buat file .env di root dengan: OPENROUTER_API_KEY=your_key_here');
    console.warn('   Dapatkan API key dari: https://openrouter.ai/keys');
} else {
    console.log('✅ OPENROUTER_API_KEY ditemukan dan siap digunakan.');
}

const settings = require('./config/settings');
const { connectToWhatsApp } = require('./lib/waClient');
const WhatsAppHandler = require('./handlers/waHandler');
const { startCronJobs } = require('./jobs/serverMonitor');

console.log(`Starting ${settings.app.name} v${settings.app.version} in ${settings.app.env} mode`);

// Variabel untuk menyimpan instance WhatsApp
let waSocket = null;
let waHandler = null;
let monitorCronTask = null;

// Fungsi untuk memulai WhatsApp bot
async function startWhatsAppBot() {
    try {
        console.log('Menghubungkan ke WhatsApp...');
        waSocket = await connectToWhatsApp();
        
        // Inisialisasi WhatsApp handler hanya setelah koneksi benar-benar terbuka
        waHandler = new WhatsAppHandler(waSocket);
        console.log('WhatsApp handler berhasil diinisialisasi');
        
        console.log('Bot berhasil terhubung dan siap menerima pesan!');
        
        // Tambahkan event listener untuk menangani error koneksi
        waSocket.ev.on('connection.update', (update) => {
            if (update.connection === 'close') {
                console.log('Koneksi terputus dari dalam handler. Mencoba ulang...');
                // Restart bot
                setTimeout(() => {
                    startWhatsAppBot();
                }, 10000);
            }
        });
        
    } catch (error) {
        console.error('Gagal memulai WhatsApp bot:', error.message);
        // Coba ulang setelah waktu yang bervariasi
        const retryDelay = Math.floor(Math.random() * 10000) + 10000; // 10-20 detik
        console.log(`Mencoba menghubungkan kembali dalam ${retryDelay/1000} detik...`);
        setTimeout(() => {
            startWhatsAppBot();
        }, retryDelay);
    }
}

// Fungsi untuk menghentikan WhatsApp bot
function stopWhatsAppBot() {
    if (waSocket) {
        console.log('Menghentikan WhatsApp bot...');
        waSocket = null;
        waHandler = null;
    }
}

// Fungsi utama
async function main() {
    // TODO: Initialize other clients, services, handlers, and jobs
    
    // Start WhatsApp bot
    await startWhatsAppBot();
    
    monitorCronTask = startCronJobs(() => waSocket);
    
    console.log('Semua layanan berjalan!');
}

// Menjalankan aplikasi
main();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nMenerima SIGINT. Melakukan shutdown...');
    if (monitorCronTask) {
        monitorCronTask.stop();
        monitorCronTask = null;
    }
    stopWhatsAppBot();
    console.log('Shutdown selesai.');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nMenerima SIGTERM. Melakukan shutdown...');
    if (monitorCronTask) {
        monitorCronTask.stop();
        monitorCronTask = null;
    }
    stopWhatsAppBot();
    console.log('Shutdown selesai.');
    process.exit(0);
});
