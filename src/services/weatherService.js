// Weather service
const axios = require('axios');
const { formatBulletList } = require('../utils/formatter');

async function getCuaca(kota) {
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY || process.env.WEATHER_API_KEY;
        if (!apiKey) {
            return '> *ERROR API* ❌\n\nAPI key OpenWeather tidak ditemukan. Silakan hubungi administrator.';
        }
        
        const response = await axios.get(
            'https://api.openweathermap.org/data/2.5/weather',
            {
                params: {
                    q: kota,
                    appid: apiKey,
                    units: 'metric',
                    lang: 'id',
                },
                timeout: 15000,
                validateStatus: () => true,
            },
        );
        
        if (response.status < 200 || response.status >= 300) {
            if (response.status === 404) {
                return `> *KOTA TIDAK DITEMUKAN* ❌\n\nKota "${kota}" tidak ditemukan dalam database cuaca.\nPastikan penulisan nama kota benar.`;
            }
            return `> *ERROR CUACA* ❌\n\nGagal mengambil data cuaca. Status: ${response.status}`;
        }
        
        const data = response.data;
        
        const header = '> *INFO CUACA HARI INI* 🌤️';
        const body = formatBulletList({
            Kota: `${data.name}, ${data.sys.country}`,
            Kondisi: data.weather[0].description,
            Suhu: `${data.main.temp}°C`,
            Terasa: `${data.main.feels_like}°C`,
            Kelembaban: `${data.main.humidity}%`,
            Tekanan: `${data.main.pressure} hPa`,
            Angin: `${data.wind.speed} m/s`
        });
        const footer = '\n\nTetap jaga kesehatan dan sesuaikan aktivitasmu dengan cuaca.';

        return `${header}\n\n${body}${footer}`;
    } catch (error) {
        console.error('Error fetching weather:', error);
        return '> *ERROR SISTEM* ❌\n\nTerjadi kesalahan saat mengambil data cuaca. Silakan coba lagi nanti.';
    }
}

async function handleWeatherCommand(command, args, userId, platform) {
    if (command !== '/cuaca') {
        return 'Perintah tidak dikenali.';
    }
    
    if (args.length === 0) {
        const header = '> *ERROR FORMAT* ❌';
        const body = formatBulletList([
            'Gunakan format: /cuaca <nama_kota>',
            'Contoh: /cuaca Jakarta'
        ]);
        return `${header}\n\n${body}`;
    }
    
    const kota = args.join(' ');
    return await getCuaca(kota);
}

module.exports = {
    getCuaca,
    handleWeatherCommand
};
