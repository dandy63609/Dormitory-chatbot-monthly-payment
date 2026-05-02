// AI client (Mistral direct API via native fetch)
const { logAIUsage } = require("../services/logService");
const {
  buildTextOnlyUserMessage,
  coerceAiInput,
  extractUsageMetadata,
  formatForWhatsApp,
  systemInstruction,
} = require("./aiShared");

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_MISTRAL_MODEL_ID = "ministral-3b-latest";
const modelName =
  String(process.env.MISTRAL_MODEL || "").trim() || DEFAULT_MISTRAL_MODEL_ID;
const MISTRAL_RPM_LIMIT = parseInt(process.env.MISTRAL_RPM_LIMIT || "15", 10);
const requestTimestamps = [];

const generationConfig = {
  temperature: Number.parseFloat(process.env.MISTRAL_TEMPERATURE || "0.3"),
  max_tokens: parseInt(process.env.MISTRAL_MAX_TOKENS || "200", 10),
};

function trackRequestAndGetRpmStatus() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  while (requestTimestamps.length > 0 && requestTimestamps[0] < oneMinuteAgo) {
    requestTimestamps.shift();
  }

  requestTimestamps.push(now);

  const used = requestTimestamps.length;
  const remaining = Math.max(MISTRAL_RPM_LIMIT - used, 0);
  const status = remaining > 0 ? "AMAN" : "BATAS RPM";

  return {
    used,
    limit: MISTRAL_RPM_LIMIT,
    remaining,
    status,
    label: `${used}/${MISTRAL_RPM_LIMIT} (${status})`,
  };
}

function normalizeErrorMessage(body) {
  if (!body) return "";
  if (typeof body === "string") return body;
  return (
    body.message ||
    body.error?.message ||
    body.detail ||
    JSON.stringify(body)
  );
}

async function readErrorBody(response) {
  const rawBody = await response.text();
  if (!rawBody) return "";

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

async function askMistral(message, userId, platform, logUserId) {
  const detailed = await askMistralDetailed(
    message,
    userId,
    platform,
    logUserId,
  );
  return detailed.text;
}

async function askMistralDetailed(message, userId, platform, logUserId) {
  const apiKey = String(process.env.MISTRAL_API_KEY || "").trim();
  const modelId =
    String(process.env.MISTRAL_MODEL || "").trim() || DEFAULT_MISTRAL_MODEL_ID;

  try {
    console.log("AI provider: mistral");
    console.log(`Mistral model: ${modelId}`);

    if (!apiKey) {
      throw new Error("API key Mistral tidak ditemukan. Periksa file .env Anda.");
    }

    if (typeof fetch !== "function") {
      throw new Error(
        "Native fetch tidak tersedia di runtime Node.js ini. Gunakan Node.js 18+.",
      );
    }

    const input = coerceAiInput(message);
    const userContent = buildTextOnlyUserMessage(input);

    const response = await fetch(MISTRAL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: userContent },
        ],
        ...generationConfig,
      }),
    });

    if (!response.ok) {
      const error = new Error(normalizeErrorMessage(await readErrorBody(response)));
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const rawText = Array.isArray(content)
      ? content
          .map((part) => part?.text || "")
          .join("\n")
          .trim()
      : String(content || "").trim();

    if (!rawText) {
      throw new Error("Tidak ada teks dalam respons dari Mistral API");
    }

    const usage = extractUsageMetadata(data);
    const rpm = trackRequestAndGetRpmStatus();
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
      text: formatForWhatsApp(rawText),
      model: modelId,
      modelName: modelId,
      usage,
      rpm,
    };
  } catch (error) {
    const statusCode = error?.status || error?.response?.status;
    const errorMessage = String(error?.message || "Unknown error");
    const lowerErrorMessage = errorMessage.toLowerCase();

    console.error(
      "Error saat memanggil Mistral API:",
      statusCode || "-",
      errorMessage,
    );

    if (statusCode === 429 || lowerErrorMessage.includes("rate limit")) {
      throw new Error(
        "429 Rate Limit dari Mistral. Batas request tercapai, coba lagi sebentar.",
      );
    } else if (
      statusCode === 401 ||
      lowerErrorMessage.includes("unauthorized")
    ) {
      throw new Error(
        "401 Unauthorized dari Mistral. Periksa MISTRAL_API_KEY Anda.",
      );
    } else if (statusCode === 403 || lowerErrorMessage.includes("forbidden")) {
      throw new Error(
        "403 Forbidden dari Mistral. API key valid tetapi akses model ditolak.",
      );
    } else if (
      statusCode === 404 ||
      lowerErrorMessage.includes("model not found")
    ) {
      throw new Error(`Model ${modelId || modelName} tidak ditemukan di Mistral.`);
    } else if (statusCode >= 500 && statusCode <= 599) {
      throw new Error(
        `Server Mistral sedang gangguan (${statusCode}). Coba lagi nanti.`,
      );
    } else if (lowerErrorMessage.includes("tidak ditemukan")) {
      throw new Error("API key Mistral tidak ditemukan. Periksa file .env Anda.");
    } else if (lowerErrorMessage.includes("api key")) {
      throw new Error("API key Mistral tidak valid atau belum diatur.");
    } else {
      throw error;
    }
  }
}

async function askAi(message, userId, platform, logUserId) {
  return askMistral(message, userId, platform, logUserId);
}

async function askAiDetailed(message, userId, platform, logUserId) {
  return askMistralDetailed(message, userId, platform, logUserId);
}

module.exports = {
  askAi,
  askAiDetailed,
  askMistral,
  askMistralDetailed,
  modelName,
};
