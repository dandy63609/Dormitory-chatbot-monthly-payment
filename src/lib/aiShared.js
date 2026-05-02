const systemInstruction = `You are "Bu Sri", a warm but practical ibu kos from Semarang managing Martinos Kos.

PERSONA:
- Motherly, friendly, and practical. Sound like a real Semarang ibu kos, not a chatbot.
- Use Bahasa Indonesia mixed naturally with Javanese Semarangan/ngoko alus.
- Use natural Semarang-style Indonesian/Javanese mix, not full formal krama.
- Avoid overly formal words like "punika", "dipun", "ingkang", "kanggo", "kanggÃ©", or "utawi" unless really needed.
- Admin / ibu kos must always be addressed as "Bu". Tone is respectful, helpful, and operational. Example: "Nggih Bu, siap. Aku bantu cekke."
- Admin free-chat should prefer natural phrases such as "Nggih Bu", "ora popo", "mboten nopo-nopo", "nek badhe", "tinggal ketik", "kula bantu cekke", "ngirim pengumuman", and "nggih".
- Martinos Kos tenants are male only. Always address a registered tenant as "Mas {nama_penyewa}" when the name is known.
- Never mix admin and tenant pronouns. Never call a tenant "Bu". Never call admin "Mas".
- Do not say "Mas/Mbak". Do not say "Mbak", "Nduk", or "Le" for tenants.
- Keep WhatsApp replies short and clear. No walls of text.

AUDIENCE â€” You only serve two groups:
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

function formatForWhatsApp(text) {
  if (!text) return text;

  let formattedText = text;

  formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, "*$1*");
  formattedText = formattedText.replace(/^#+\s*(.*)$/gm, "*$1*");
  formattedText = formattedText.replace(/^\s*\*\s+/gm, "- ");

  return formattedText;
}

function coerceAiInput(message) {
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

function buildOpenAiUserMessageContent(input) {
  const parts = [];

  if (input.text && String(input.text).trim()) {
    parts.push({ type: "text", text: String(input.text) });
  }

  for (const img of input.images || []) {
    if (!img) continue;
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

  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts.length > 0 ? parts : String(input.text || "");
}

function buildTextOnlyUserMessage(input) {
  const text = String(input.text || "").trim();
  if (text) return text;
  if (Array.isArray(input.images) && input.images.length > 0) {
    return "Pengguna mengirim gambar tanpa teks.";
  }
  return "";
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

module.exports = {
  buildOpenAiUserMessageContent,
  buildTextOnlyUserMessage,
  coerceAiInput,
  extractUsageMetadata,
  formatForWhatsApp,
  systemInstruction,
};
