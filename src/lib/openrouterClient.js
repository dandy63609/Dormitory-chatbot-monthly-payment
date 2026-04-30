// AI client (OpenRouter via OpenAI SDK)
const OpenAI = require("openai");
const {
  AI_MODELS,
  getActiveModel,
  getModelById,
} = require("../services/aiPreferenceService");
const { logAIUsage } = require("../services/logService");

// Inisialisasi OpenRouter API
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error(
    "ERROR: OPENROUTER_API_KEY tidak ditemukan di environment variables.",
  );
  console.error(
    "Pastikan Anda telah membuat file .env dengan OPENROUTER_API_KEY=your_key_here",
  );
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey,
});

// Force model to a known Vision-capable OpenRouter model
const FORCED_OPENROUTER_MODEL_ID =
  "meta-llama/llama-3.2-11b-vision-instruct:free";
const modelName = FORCED_OPENROUTER_MODEL_ID;
const DEFAULT_OPENROUTER_MODEL_ID =
  AI_MODELS["gpt-oss"]?.id || FORCED_OPENROUTER_MODEL_ID;
const RPM_LIMIT = parseInt(
  process.env.OPENROUTER_RPM_LIMIT || process.env.GEMINI_RPM_LIMIT || "15",
  10,
);
const requestTimestamps = [];

const systemInstruction = `You are "Bu Sri", a warm but practical ibu kos from Semarang managing Martinos Kos.

PERSONA:
- Motherly, friendly, and practical. Sound like a real Semarang ibu kos, not a chatbot.
- Use Bahasa Indonesia mixed naturally with Javanese Semarangan/ngoko alus.
- Use natural Semarang-style Indonesian/Javanese mix, not full formal krama.
- Avoid overly formal words like "punika", "dipun", "ingkang", "kanggo", "kanggé", or "utawi" unless really needed.
- Admin / ibu kos must always be addressed as "Bu". Tone is respectful, helpful, and operational. Example: "Nggih Bu, siap. Aku bantu cekke."
- Admin free-chat should prefer natural phrases such as "Nggih Bu", "ora popo", "mboten nopo-nopo", "nek badhe", "tinggal ketik", "kula bantu cekke", "ngirim pengumuman", and "nggih".
- Martinos Kos tenants are male only. Always address a registered tenant as "Mas {nama_penyewa}" when the name is known.
- Never mix admin and tenant pronouns. Never call a tenant "Bu". Never call admin "Mas".
- Do not say "Mas/Mbak". Do not say "Mbak", "Nduk", or "Le" for tenants.
- Keep WhatsApp replies short and clear. No walls of text.

AUDIENCE — You only serve two groups:
1. Admin / ibu kos: menu guidance only includes /listrik and /umumkan. Admin can use /kos_info to see the menu.
2. Registered tenants (penghuni): menu guidance only includes /bayar_listrik and /status_bayar_info.
Unregistered senders are blocked before reaching you. Do NOT ask them to register.

STRICT RULES:
- Do NOT mention Fuenzer Bot, Ridwan Yoga Suryantara, model names, token usage, CPU/RAM, downloader, converter, or any old bot features.
- Do NOT recommend /lunas_listrik as an available admin menu command.
- Never mention /listrik_saya, /status_bayar, or /upload_bukti.
- Explain /terima_bukti and /tolak_bukti only when discussing proof verification after a tenant uploads payment proof.
- For tenant payment topics, guide back to /bayar_listrik or /status_bayar_info.
- If admin says "matur suwun", reply like: "Nggih Bu, sami-sami. Nek badhe cek listrik, tinggal ketik /listrik. Nek badhe ngirim pengumuman, tinggal ketik /umumkan nggih."
- If a tenant asks how you know his name, answer exactly: "Nggih, Mas {nama_penyewa}. Nama panjenengan tak ambil saka data penghuni Martinos Kos, sesuai nomor WhatsApp sing terdaftar."
- If a tenant asks "saya mas/mba?", answer exactly: "Panjenengan tak panggil Mas {nama_penyewa}, soale data penghuni Martinos Kos iki khusus penghuni putra."
- Do NOT claim room availability, price, address, or payment status unless data is explicitly given in this conversation.
- Do NOT reveal any other tenant's data, KTP number, home address, or parent contacts.
- For database-changing actions, always guide user to use the correct command and the confirmation flow.
- If asked something outside your knowledge, say so simply and suggest the right command or person to contact.`;

const generationConfig = {
  temperature: 0.7,
  top_p: 0.8,
  max_tokens: 1024,
};

/**
 * Fungsi untuk membersihkan dan memformat Markdown AI agar sesuai dengan standar WhatsApp
 * @param {string} text - Teks mentah dari AI
 * @returns {string} - Teks yang sudah diformat untuk WA
 */
function formatForWhatsApp(text) {
  if (!text) return text;

  let formattedText = text;

  // Ubah Bold: **teks** menjadi *teks*
  formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, "*$1*");

  // Ubah Header Markdown: ### Judul menjadi *Judul*
  formattedText = formattedText.replace(/^#+\s*(.*)$/gm, "*$1*");

  // Ubah Bullet Points: dari * menjadi - agar tidak salah terbaca sebagai bold di WA
  formattedText = formattedText.replace(/^\s*\*\s+/gm, "- ");

  return formattedText;
}

/**
 * Fungsi untuk berinteraksi dengan AI
 * @param {string} message - Pesan dari pengguna
 * @returns {Promise<string>} - Jawaban dari AI
 */
async function askGemini(message, userId, platform, logUserId) {
  const detailed = await askGeminiDetailed(
    message,
    userId,
    platform,
    logUserId,
  );
  return detailed.text;
}

function trackRequestAndGetRpmStatus() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  while (requestTimestamps.length > 0 && requestTimestamps[0] < oneMinuteAgo) {
    requestTimestamps.shift();
  }

  requestTimestamps.push(now);

  const used = requestTimestamps.length;
  const remaining = Math.max(RPM_LIMIT - used, 0);
  const status = remaining > 0 ? "AMAN" : "BATAS RPM";

  return {
    used,
    limit: RPM_LIMIT,
    remaining,
    status,
    label: `${used}/${RPM_LIMIT} (${status})`,
  };
}

function extractUsageMetadata(response) {
  const usage = response?.usage || {};

  const promptTokenCount = usage.prompt_tokens || 0;
  const candidatesTokenCount = usage.completion_tokens || 0;
  const totalTokenCount =
    usage.total_tokens || promptTokenCount + candidatesTokenCount;

  return {
    promptTokenCount,
    candidatesTokenCount,
    totalTokenCount,
  };
}

function coerceAiInput(message) {
  // Backwards compatible:
  // - string -> { text }
  // - { text, images } -> as is
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const text =
      typeof message.text === "string"
        ? message.text
        : String(message.text || "");
    const images = Array.isArray(message.images) ? message.images : [];
    return { text, images };
  }
  return { text: String(message || ""), images: [] };
}

function buildUserMessageContent(input) {
  const parts = [];

  if (input.text && String(input.text).trim()) {
    parts.push({ type: "text", text: String(input.text) });
  }

  for (const img of input.images || []) {
    if (!img) continue;
    // Accept { url } or { base64, mimeType } or { data, mimeType }
    const url = typeof img.url === "string" ? img.url : "";
    const mimeType =
      typeof img.mimeType === "string"
        ? img.mimeType
        : typeof img.mimetype === "string"
          ? img.mimetype
          : "";
    const base64 =
      typeof img.base64 === "string"
        ? img.base64
        : typeof img.data === "string"
          ? img.data
          : "";

    let finalUrl = url;
    if (!finalUrl && base64) {
      const mt = mimeType || "image/jpeg";
      finalUrl = `data:${mt};base64,${base64}`;
    }

    if (finalUrl) {
      parts.push({ type: "image_url", image_url: { url: finalUrl } });
    }
  }

  // OpenAI API expects either string or array; if we only have text, keep it simple.
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts.length > 0 ? parts : String(input.text || "");
}

async function askGeminiDetailed(message, userId, platform, logUserId) {
  let modelId = modelName;

  try {
    // Validasi API key
    if (!apiKey) {
      throw new Error(
        "API key OpenRouter tidak ditemukan. Periksa file .env Anda.",
      );
    }

    try {
      const preferredModelId = await getActiveModel(userId, platform);
      modelId = preferredModelId || DEFAULT_OPENROUTER_MODEL_ID;
    } catch (preferenceError) {
      console.warn(
        "AI preference lookup failed; using default model:",
        preferenceError.message,
      );
      modelId = DEFAULT_OPENROUTER_MODEL_ID;
    }

    // Log untuk debugging
    console.log(
      `Mengirim permintaan ke OpenRouter API dengan model: ${modelId}`,
    );

    const input = coerceAiInput(message);

    const response = await openai.chat.completions.create({
      model: modelId,
      messages: [
        { role: "system", content: systemInstruction },
        { role: "user", content: buildUserMessageContent(input) },
      ],
      ...generationConfig,
    });

    const content = response?.choices?.[0]?.message?.content;
    const rawText = Array.isArray(content)
      ? content
          .map((part) => part?.text || "")
          .join("\n")
          .trim()
      : String(content || "").trim();

    // Periksa jika ada teks
    if (!rawText) {
      throw new Error("Tidak ada teks dalam respons dari OpenRouter API");
    }

    // Ambil teks mentah lalu format untuk WhatsApp
    const finalMessageWA = formatForWhatsApp(rawText);
    const usage = extractUsageMetadata(response);
    const rpm = trackRequestAndGetRpmStatus();
    const modelMeta = getModelById(modelId);

    const aiLogUserId = typeof logUserId === "string" ? logUserId : userId;

    try {
      await logAIUsage(
        aiLogUserId,
        platform,
        modelId,
        typeof message === "string"
          ? message
          : String(coerceAiInput(message).text || ""),
        usage.promptTokenCount,
        usage.candidatesTokenCount,
      );
    } catch (logError) {
      console.warn("AI usage logging failed; continuing response:", logError.message);
    }

    return {
      text: finalMessageWA,
      model: modelId,
      modelName: modelMeta?.name || modelId,
      usage,
      rpm,
    };
  } catch (error) {
    const statusCode = error?.status || error?.response?.status;
    const errorMessage = String(error?.message || "Unknown error");
    const lowerErrorMessage = errorMessage.toLowerCase();

    console.error(
      "Error saat memanggil OpenRouter API:",
      statusCode || "-",
      errorMessage,
    );

    // Pesan Error
    if (statusCode === 429 || lowerErrorMessage.includes("rate limit")) {
      throw new Error(
        "429 Rate Limit dari OpenRouter. Batas request tercapai, coba lagi sebentar.",
      );
    } else if (
      statusCode === 401 ||
      lowerErrorMessage.includes("unauthorized")
    ) {
      throw new Error(
        "401 Unauthorized dari OpenRouter. Periksa OPENROUTER_API_KEY Anda.",
      );
    } else if (statusCode === 403 || lowerErrorMessage.includes("forbidden")) {
      throw new Error(
        "403 Forbidden dari OpenRouter. API key valid tetapi akses model ditolak.",
      );
    } else if (
      statusCode === 404 ||
      lowerErrorMessage.includes("model not found")
    ) {
      throw new Error(
        `Model ${modelId || modelName} tidak ditemukan di OpenRouter.`,
      );
    } else if (statusCode >= 500 && statusCode <= 599) {
      throw new Error(
        `Server OpenRouter sedang gangguan (${statusCode}). Coba lagi nanti.`,
      );
    } else if (lowerErrorMessage.includes("api key")) {
      throw new Error("API key OpenRouter tidak valid atau belum diatur.");
    } else {
      throw error;
    }
  }
}

async function askAi(message, userId, platform, logUserId) {
  return askGemini(message, userId, platform, logUserId);
}

async function askAiDetailed(message, userId, platform, logUserId) {
  return askGeminiDetailed(message, userId, platform, logUserId);
}

module.exports = {
  askGemini,
  askGeminiDetailed,
  askAi,
  askAiDetailed,
  modelName,
};
