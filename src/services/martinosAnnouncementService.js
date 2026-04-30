const supabase = require('../lib/supabaseClient');

// Valid announcement targets
const VALID_TARGETS = ['semua', 'martinos1', 'martinos2', 'martinos3'];

// ⚠️ CONFIRM: activity_logs table may not exist yet
const ACTIVITY_LOGS_TABLE = 'activity_logs';

/**
 * Resolves a target string to one or more WhatsApp group JIDs sourced
 * exclusively from environment variables (no Supabase query in MVP).
 *
 * @param {string} target - 'semua' | 'martinos1' | 'martinos2' | 'martinos3'
 * @returns {string[]} non-empty array of JID strings
 * @throws {Error} if target is not one of the four valid values
 * @throws {Error} if the resolved JID list is empty (env vars not set)
 */
function getGroupJids(target) {
  const normalised = String(target || '').trim().toLowerCase();

  if (!VALID_TARGETS.includes(normalised)) {
    throw new Error(
      `Target tidak valid: "${target}". Gunakan salah satu dari: ${VALID_TARGETS.join(', ')}.`
    );
  }

  // JID map — values come from environment variables only
  const JID_MAP = {
    martinos1: process.env.MARTINOS_GROUP_1_JID,
    martinos2: process.env.MARTINOS_GROUP_2_JID,
    martinos3: process.env.MARTINOS_GROUP_3_JID
  };

  let jids;
  if (normalised === 'semua') {
    // Include all three; skip any that are empty/missing
    jids = Object.values(JID_MAP)
      .filter((jid) => jid && String(jid).trim())
      .map((jid) => String(jid).trim());
  } else {
    const singleJid = JID_MAP[normalised];
    jids = singleJid && String(singleJid).trim()
      ? [String(singleJid).trim()]
      : [];
  }

  if (jids.length === 0) {
    throw new Error(
      `Tidak ada JID yang dikonfigurasi untuk target "${target}". ` +
      'Periksa environment variable MARTINOS_GROUP_1_JID, MARTINOS_GROUP_2_JID, MARTINOS_GROUP_3_JID.'
    );
  }

  return jids;
}

/**
 * Wraps a plain message body in the standard Martinos Kos announcement template.
 *
 * @param {string} message - raw announcement body
 * @returns {string} formatted announcement ready to send
 */
function buildAnnouncementText(message) {
  return `*Pengumuman Martinos Kos* 📢\n\n${message}\n\nMatur nuwun.\n- Bu Kos`;
}

/**
 * Sends a formatted announcement to one or more WhatsApp groups.
 *
 * Per-JID failures are caught, logged, and skipped — the loop continues
 * to the next JID regardless.  Only throws if every single send failed.
 *
 * @param {object} sock    - Baileys WhatsApp socket
 * @param {string} target  - 'semua' | 'martinos1' | 'martinos2' | 'martinos3'
 * @param {string} message - raw announcement body text
 * @returns {Promise<{
 *   successCount: number,
 *   totalCount: number,
 *   results: Array<{ jid: string, success: boolean, error?: string }>
 * }>}
 * @throws {Error} if getGroupJids throws (invalid target / no JIDs configured)
 * @throws {Error} 'Gagal mengirim ke semua grup. Periksa JID dan koneksi.' if successCount === 0
 */
async function sendAnnouncement(sock, target, message) {
  // Throws early if target is invalid or env vars are missing
  const jids = getGroupJids(target);
  const text = buildAnnouncementText(message);

  const results = [];
  let successCount = 0;

  for (const jid of jids) {
    try {
      await sock.sendMessage(jid, { text });
      results.push({ jid, success: true });
      successCount += 1;
    } catch (err) {
      console.error(`[martinosAnnouncementService] Failed to send to JID "${jid}":`, err);
      results.push({ jid, success: false, error: err?.message || String(err) });
    }
  }

  if (successCount === 0) {
    throw new Error('Gagal mengirim ke semua grup. Periksa JID dan koneksi.');
  }

  return { successCount, totalCount: jids.length, results };
}

/**
 * Logs a sent announcement to the activity_logs table.
 *
 * This function is intentionally fire-and-forget safe: any Supabase error
 * or table-not-found condition is silently swallowed and logged to the
 * console only.  It will never cause the calling code to fail.
 *
 * @param {string} target   - announcement target used
 * @param {string} message  - announcement body that was sent
 * @param {string} adminId  - WhatsApp JID or identifier of the acting admin
 * @returns {Promise<void>}
 */
async function logAnnouncement(target, message, adminId) {
  try {
    // ⚠️ CONFIRM: activity_logs table may not exist yet — designed to fail silently
    const { error } = await supabase
      .from(ACTIVITY_LOGS_TABLE)
      .insert({
        actor_id: adminId,           // ⚠️ CONFIRM: column name 'actor_id' may differ
        action:   'announcement_sent',
        details:  { target, message } // ⚠️ CONFIRM: 'details' column must accept JSONB
      });

    if (error) {
      console.log(
        `[logAnnouncement] Supabase insert to "${ACTIVITY_LOGS_TABLE}" failed (non-fatal):`,
        error.message
      );
    }
  } catch (err) {
    console.log(
      '[logAnnouncement] Unexpected error while logging announcement (non-fatal):',
      err?.message || err
    );
  }
}

module.exports = {
  getGroupJids,
  sendAnnouncement,
  logAnnouncement,
  buildAnnouncementText
};
