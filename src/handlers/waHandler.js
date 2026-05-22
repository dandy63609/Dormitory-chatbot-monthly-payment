const { resolveRole, normalizePhone } = require("../services/tenantService");
const {
  handleKosCommand,
  handleProofUpload,
  handlePendingConfirmation,
} = require("../commands/kos/index");
const { logCommand } = require("../services/logService");

const MARTINOS_ONLY_COMMANDS = new Set([
  "/saldo",
  "/catat",
  "/pemasukan",
  "/laporan_chart",
  "/riwayat",
  "/hapus",
  "/edit",
  "/finance_info",
  "/research_info",
  "/buku",
  "/jurnal",
  "/artikel",
  "/downloader",
  "/download",
  "/audio",
  "/model_info",
  "/switch",
  "/img",
  "/img_info",
  "/hapusbg",
  "/ss",
  "/pdf",
  "/pdf_info",
  "/topdf",
  "/sticker_info",
  "/tosticker",
  "/donate",
  "/short",
  "/me",
  "/cuaca",
  "/sholat",
  "/ai_usage",
  "/stats",
  "/cmd_usage",
  "/admin",
  "/broadcast",
  "/monitor",
]);

const NOT_REGISTERED_REPLY = [
  "> *Ngapunten ya*",
  "",
  "Nomor panjenengan durung terdaftar sebagai penghuni Martinos Kos.",
  "Nek merasa sudah jadi penghuni, hubungi ibu kos supaya nomore didaftarkan dulu.",
].join("\n");

const MARTINOS_ONLY_REPLY = [
  "> *Fitur iki ora tersedia nang Martinos Kos*",
  "",
  "Bot iki khusus bantu operasional Martinos Kos.",
  "Ketik */info* kanggo lihat menu sing tersedia nggih.",
].join("\n");

function isSendTimeoutOrConnectionError(error) {
  const statusCode = error?.statusCode || error?.output?.statusCode;
  const message = String(error?.message || "").toLowerCase();

  return (
    statusCode === 408 ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("connection closed") ||
    message.includes("not open") ||
    message.includes("socket")
  );
}

async function safeSendMessage(sock, jid, content, options) {
  try {
    return await sock.sendMessage(jid, content, options);
  } catch (error) {
    const statusCode = error?.statusCode || error?.output?.statusCode || "-";
    const message = String(error?.message || "Unknown sendMessage error");

    if (isSendTimeoutOrConnectionError(error)) {
      console.warn(`WhatsApp send skipped: ${statusCode} ${message}`);
      return null;
    }

    console.error(`WhatsApp send failed: ${statusCode} ${message}`);
    return null;
  }
}

function formatWhatsAppReply(text) {
  return String(text || "");
}

function normalizeWhatsAppId(value) {
  return normalizePhone(value);
}

function toWhatsAppJid(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("@g.us")) return raw;

  const normalized = normalizeWhatsAppId(raw);
  return normalized ? `${normalized}@s.whatsapp.net` : "";
}

function resolveWhatsAppSenderJid(msg, fallbackUserId = "") {
  const candidates = [
    msg?.key?.senderPn,
    msg?.key?.participant,
    fallbackUserId,
    msg?.key?.remoteJid,
  ];

  for (const candidate of candidates) {
    const raw = String(candidate || "").trim();
    if (!raw || raw.endsWith("@g.us") || raw.includes("@lid")) continue;

    const jid = toWhatsAppJid(raw);
    if (jid) return jid;
  }

  return "";
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMessageContextInfo(msg) {
  return (
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.buttonsResponseMessage?.contextInfo ||
    msg.message?.templateButtonReplyMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    null
  );
}

function cleanMentionFromGroupText(text, mentionIds = []) {
  let cleanText = String(text || "").trim();
  const normalizedMentionIds = mentionIds
    .map((mentionId) => normalizeWhatsAppId(mentionId))
    .filter(Boolean);

  for (const mentionId of normalizedMentionIds) {
    const mentionRegex = new RegExp(`@${escapeRegex(mentionId)}\\b`, "gi");
    cleanText = cleanText.replace(mentionRegex, " ");
  }

  cleanText = cleanText.replace(/^(@\S+\s+)+(?=\/)/, "");
  return cleanText.replace(/\s{2,}/g, " ").trim();
}

function extractText(msg) {
  const message = msg.message || {};

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.buttonsResponseMessage?.selectedButtonId) {
    return message.buttonsResponseMessage.selectedButtonId;
  }
  if (message.templateButtonReplyMessage?.selectedId) {
    return message.templateButtonReplyMessage.selectedId;
  }

  return "";
}

function getTenantAiName(tenant) {
  return tenant?.nama_penyewa || tenant?.name || "Penghuni";
}

function getTenantAiRoomCode(tenant) {
  return tenant?.nomor_kamar || tenant?.rooms?.code || "-";
}

function getTenantAiBuildingName(tenant) {
  return tenant?.gedung?.nama || tenant?.rooms?.buildings?.name || "-";
}

function buildAdminDeterministicAiReply(message) {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) return null;

  const asksIdentity =
    /\b(siapa|sapa|sopo)\b/.test(normalized) ||
    normalized.includes("ini siapa") ||
    normalized.includes("iki sapa") ||
    normalized.includes("kamu siapa") ||
    normalized.includes("anda siapa") ||
    normalized.includes("sampeyan sapa") ||
    normalized.includes("jenengan sapa");
  if (asksIdentity) {
    return "Kula Ajeng, asisten Martinos Kos, Bu Umi. Kula bantu urusan listrik lan pengumuman Martinos Kos.";
  }

  const asksLanguage =
    normalized.includes("bahasa apa") ||
    normalized.includes("bahasanya apa") ||
    normalized.includes("bahasamu apa") ||
    normalized.includes("bahasane apa") ||
    normalized.includes("ngomong apa") ||
    normalized.includes("pakai bahasa apa") ||
    normalized.includes("pake bahasa apa");
  if (asksLanguage) {
    return "Niki bahasa Indonesia campur Jawa Semarangan ringan, Bu Umi. Ben rasane luwih cedhak lan santai.";
  }

  const saysThanks =
    normalized.includes("matur suwun") ||
    normalized.includes("terima kasih") ||
    normalized.includes("makasih") ||
    normalized.includes("thanks");
  if (saysThanks) {
    return "Nggih Bu Umi, sami-sami.";
  }

  return null;
}

function normalizeAliasText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_/-]/gu, " ")
    .replace(/\s+/g, " ");
}

function getTenantCommandAlias(text) {
  const normalized = normalizeAliasText(text);
  if (!normalized || normalized.startsWith("/")) return "";

  const paymentAliases = new Set([
    "bayar listrik",
    "mau bayar",
    "aku mau bayar",
    "saya mau bayar",
    "mau bayar listrik",
    "ingin bayar listrik",
  ]);

  const statusAliases = new Set([
    "cek listrik",
    "cek tagihan listrik",
    "status bayar",
    "status pembayaran",
    "status listrik",
    "cek status bayar",
  ]);

  if (paymentAliases.has(normalized)) return "/bayar_listrik";
  if (statusAliases.has(normalized)) return "/status_bayar_info";
  return "";
}

function buildRoleClaimReply(message, role, tenant) {
  const normalized = String(message || "").trim().toLowerCase();
  const claimsTenant =
    normalized.includes("saya tenant") ||
    normalized.includes("saya tenants") ||
    normalized.includes("aku tenant") ||
    normalized.includes("aku penghuni") ||
    normalized.includes("saya penghuni");
  const claimsAdmin =
    normalized.includes("saya admin") ||
    normalized.includes("aku admin") ||
    normalized.includes("saya ibu kos") ||
    normalized.includes("aku ibu kos");

  if (role === "admin" && claimsTenant) {
    return buildAdminGreetingReply(false);
  }

  if (role === "tenant" && claimsAdmin) {
    return [
      `Ngapunten Mas ${getTenantAiName(tenant)}, nomor iki terdaftar sebagai penghuni, dudu admin.`,
      '',
      buildTenantGreetingReply(tenant),
    ].join('\n');
  }

  return null;
}

function isGreetingText(text) {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");

  return new Set([
    "halo",
    "hallo",
    "hai",
    "hi",
    "hello",
    "start",
    "info",
    "menu",
    "pagi",
    "siang",
    "sore",
    "malam",
    "assalamualaikum",
    "assalamu alaikum",
  ]).has(normalized);
}

function buildTenantGreetingReply(tenant) {
  return [
    `> *Halo Mas ${getTenantAiName(tenant)}, Kula Ajeng*`,
    '',
    `Panjenengan terdaftar nang *${getTenantAiBuildingName(tenant)}*, kamar *${getTenantAiRoomCode(tenant)}*.`,
    'Ajeng bantu urusan pembayaran listrik Martinos Kos.',
    '',
    '*Sing saged Mas lakoni:*',
    '- */bayar_listrik* : mulai proses bayar listrik bulan iki.',
    '- */status_bayar_info* : cek status pembayaran listrik panjenengan.',
    '',
    '*Contoh:*',
    '/bayar_listrik',
    '/status_bayar_info',
  ].join("\n");
}

function buildAdminGreetingReply(isDualRoleTest = false) {
  const lines = [
    "> *Halo Bu Umi, Kula Ajeng*",
    "",
    "Panjenengan terdaftar sebagai admin Martinos Kos.",
    "Ajeng bantu cek pembayaran listrik, verifikasi bukti, catat pembayaran manual, lan ngirim pengumuman kos.",
    "",
    "*Sing saged Bu Umi lakoni:*",
    "- */listrik <bulan> <tahun>* : ringkasan pembayaran listrik.",
    "- */sudah_listrik <bulan> <tahun>* : daftar penghuni sing sampun bayar.",
    "- */belum_listrik <bulan> <tahun>* : daftar penghuni sing dereng bayar.",
    "- */lunas_listrik <kamar> <bulan> <tahun> <cash|transfer>* : catat pembayaran manual.",
    "- */umumkan <target> <pesan>* : kirim pengumuman ke grup kos.",
    "- */terima_bukti <kode>* / */tolak_bukti <kode> <alasan>* : proses bukti pembayaran.",
    "",
    "*Contoh:*",
    "/listrik mei 2026",
    "/sudah_listrik mei 2026",
    "/belum_listrik mei 2026",
    "/lunas_listrik k2-01 mei 2026 cash",
    "/umumkan semua Besok air mati jam 10 pagi",
  ];

  if (isDualRoleTest) {
    lines.unshift("Nomor iki lagi mode testing admin + tenant.");
  }

  return lines.join("\n");
}

function buildRoleHelpReply(role, tenant, isDualRoleTest = false) {
  if (role === "admin") return buildAdminGreetingReply(isDualRoleTest);
  if (role === "tenant") return buildTenantGreetingReply(tenant);
  return NOT_REGISTERED_REPLY;
}

function buildRoleAwareAiPrompt(message, role, tenant) {
  const userMessage = String(message || "").trim();

  if (role === "admin") {
    return [
      "[Martinos role context]",
      "RESOLVED_ROLE_FROM_CODE: admin",
      "You are Ajeng, WhatsApp assistant for Martinos Kos.",
      "Always address admin as Bu Umi.",
      "Use short, natural Indonesian mixed with light Semarang/Javanese phrasing.",
      "Do not mention AI model names, providers, token usage, RPM, internal settings, old bot branding, old chat platforms, downloader, converter, PDF, sticker, finance, donation, creator profile, weather, or sholat features.",
      "Only mention Martinos commands when helpful: /listrik, /sudah_listrik, /belum_listrik, /umumkan, /terima_bukti, /tolak_bukti, /lunas_listrik.",
      "Mention /lunas_listrik only as manual fallback when admin asks how to record payment without tenant proof.",
      "If asked identity, answer exactly: Kula Ajeng, asisten Martinos Kos, Bu Umi. Kula bantu urusan listrik lan pengumuman Martinos Kos.",
      "",
      "[User message]",
      userMessage,
    ].join("\n");
  }

  const tenantName = getTenantAiName(tenant);
  const roomCode = getTenantAiRoomCode(tenant);
  const buildingName = getTenantAiBuildingName(tenant);

  return [
    "[Martinos role context]",
    "RESOLVED_ROLE_FROM_CODE: tenant",
    `TENANT_NAME: ${tenantName}`,
    `ROOM_CODE: ${roomCode}`,
    `BUILDING_NAME: ${buildingName}`,
    "You are Ajeng, WhatsApp assistant for Martinos Kos.",
    "Always address this tenant as Mas plus his name.",
    "Use short, natural Indonesian mixed with light Semarang/Javanese phrasing.",
    "Do not mention AI model names, providers, token usage, RPM, internal settings, old bot branding, old chat platforms, downloader, converter, PDF, sticker, finance, donation, creator profile, weather, or sholat features.",
    "For tenant payment topics, guide to /bayar_listrik or /status_bayar_info.",
    "Do not claim live payment status unless the user uses the payment status command.",
    `If asked how you know his name, answer exactly: Nggih, Mas ${tenantName}. Nama panjenengan tak ambil saka data penghuni Martinos Kos, sesuai nomor WhatsApp sing terdaftar.`,
    "",
    "[User message]",
    userMessage,
  ].join("\n");
}

const TENANT_DUAL_ROLE_COMMANDS = new Set([
  "/bayar_listrik",
  "/status_bayar_info",
  "/cash",
  "/transfer",
]);

const ADMIN_DUAL_ROLE_COMMANDS = new Set([
  "/listrik",
  "/sudah_listrik",
  "/sudah-listrik",
  "/belum_listrik",
  "/lunas_listrik",
  "/umumkan",
  "/terima_bukti",
  "/tolak_bukti",
]);

function getNormalizedCommandLike(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return "";

  if (normalized.startsWith("/")) return normalized.split(/\s+/)[0];

  const firstWord = normalized.split(/\s+/)[0];
  if (firstWord === "cash" || firstWord === "transfer") {
    return `/${firstWord}`;
  }

  return getTenantCommandAlias(normalized);
}

function getEffectiveRoleForMessage(roleContext, cleanText, hasProofMedia) {
  if (!roleContext?.roleConflict || !roleContext?.dualRoleTestMode) {
    return {
      role: roleContext?.role || "unknown",
      tenant: roleContext?.tenant || null,
      isDualRoleTest: false,
    };
  }

  if (hasProofMedia) {
    return { role: "tenant", tenant: roleContext.tenant, isDualRoleTest: true };
  }

  const command = getNormalizedCommandLike(cleanText);
  if (TENANT_DUAL_ROLE_COMMANDS.has(command)) {
    return { role: "tenant", tenant: roleContext.tenant, isDualRoleTest: true };
  }

  if (ADMIN_DUAL_ROLE_COMMANDS.has(command)) {
    return { role: "admin", tenant: roleContext.tenant, isDualRoleTest: true };
  }

  return { role: "admin", tenant: roleContext.tenant, isDualRoleTest: true };
}

function getUnavailableCommandReply(command) {
  return MARTINOS_ONLY_COMMANDS.has(command)
    ? MARTINOS_ONLY_REPLY
    : `> *COMMAND TIDAK DIKENAL*\n\nPerintah "${command}" tidak tersedia.\nKetik /kos_info untuk menu admin, atau /info untuk menu penghuni.`;
}

class WhatsAppHandler {
  constructor(sock, options = {}) {
    this.sock = sock;
    this.getSock = typeof options.getSock === "function" ? options.getSock : () => this.sock;
    this.listen();
  }

  listen() {
    this.sock.ev.on("messages.upsert", async (m) => {
      if (m.type !== "notify") return;

      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid.endsWith("@g.us");
      const userId = isGroup
        ? msg.key.participant || msg.participant || remoteJid
        : remoteJid;
      const activeSock = this.getSock();
      const botJid = activeSock?.user?.id || this.sock.user?.id || "";
      const botNumber = normalizeWhatsAppId(botJid);
      const contextInfo = getMessageContextInfo(msg);
      const mentionedJids = contextInfo?.mentionedJid || [];
      const botLid = normalizeWhatsAppId(process.env.BOT_WA_LID);
      const isBotMentioned = mentionedJids.some((jid) => {
        const normalizedJid = normalizeWhatsAppId(jid);
        return normalizedJid === botNumber || normalizedJid === botLid;
      });
      const isReplyToBot =
        normalizeWhatsAppId(contextInfo?.participant) === botNumber;

      if (isGroup && !isBotMentioned && !isReplyToBot) return;

      let cleanText = extractText(msg).trim();
      if (isGroup && isBotMentioned) {
        cleanText = cleanMentionFromGroupText(cleanText, [
          botNumber,
          botLid,
          ...mentionedJids,
        ]);
      }

      const realId = resolveWhatsAppSenderJid(msg, userId) || userId;
      const roleContext = await resolveRole(realId, {
        rawJid: msg.key.participant || remoteJid,
      });
      const hasKosProofMedia =
        Boolean(msg.message?.imageMessage) || Boolean(msg.message?.documentMessage);
      const effectiveRole = getEffectiveRoleForMessage(
        roleContext,
        cleanText,
        hasKosProofMedia,
      );
      const role = effectiveRole.role;
      const tenant = effectiveRole.tenant;

      if (role === "unknown") {
        await safeSendMessage(
          this.sock,
          remoteJid,
          { text: formatWhatsAppReply(NOT_REGISTERED_REPLY) },
          { quoted: msg },
        );
        return;
      }

      if (!cleanText.startsWith("/")) {
        const roleClaimReply =
          effectiveRole.isDualRoleTest
            ? null
            : buildRoleClaimReply(cleanText, role, tenant);
        if (roleClaimReply) {
          await safeSendMessage(this.getSock(), remoteJid, { text: roleClaimReply }, { quoted: msg });
          return;
        }

        if (isGreetingText(cleanText)) {
          const greetingReply =
            buildRoleHelpReply(role, tenant, effectiveRole.isDualRoleTest);
          await safeSendMessage(this.getSock(), remoteJid, { text: greetingReply }, { quoted: msg });
          return;
        }
      }

      const pendingReply = await handlePendingConfirmation(
        cleanText,
        realId,
        role,
        tenant,
        this.getSock(),
      );
      if (pendingReply !== null) {
        await safeSendMessage(this.getSock(), remoteJid, { text: pendingReply }, { quoted: msg });
        return;
      }

      if (role === "tenant" && hasKosProofMedia) {
        const proofHandled = await handleProofUpload(
          msg,
          realId,
          tenant,
          this.getSock(),
          { getSock: () => this.getSock() },
        );
        if (proofHandled) return;
      }

      const tenantAliasCommand =
        role === "tenant" ? getTenantCommandAlias(cleanText) : "";
      if (tenantAliasCommand) cleanText = tenantAliasCommand;

      if (cleanText.startsWith("/")) {
        const parts = cleanText.split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        if (command && realId) {
          await logCommand(realId, "whatsapp", command);
        }

        const kosReply = await handleKosCommand(
          command,
          args,
          realId,
          role,
          tenant,
          this.getSock(),
          msg,
        );
        const replyText = kosReply !== null ? kosReply : getUnavailableCommandReply(command);
        await safeSendMessage(this.getSock(), remoteJid, { text: replyText }, { quoted: msg });
        return;
      }

      if (cleanText.length <= 2) {
        await safeSendMessage(
          this.getSock(),
          remoteJid,
          { text: "Maaf, pesan terlalu pendek utawa kurang jelas. Ketik /info kanggo lihat menu nggih." },
          { quoted: msg },
        );
        return;
      }

      await safeSendMessage(
        this.getSock(),
        remoteJid,
        { text: buildRoleHelpReply(role, tenant, effectiveRole.isDualRoleTest) },
        { quoted: msg },
      );
      return;
    });
  }
}

module.exports = WhatsAppHandler;
module.exports.getTenantCommandAlias = getTenantCommandAlias;
module.exports.__test = {
  buildRoleAwareAiPrompt,
  buildRoleHelpReply,
  getUnavailableCommandReply,
};
