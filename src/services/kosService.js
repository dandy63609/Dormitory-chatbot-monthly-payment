const supabase = require('../lib/supabaseClient');

// ⚠️ CONFIRM: table name may differ
const BUILDINGS_TABLE = 'buildings';
// ⚠️ CONFIRM: table name may differ
const ROOMS_TABLE = 'rooms';

/**
 * Looks up a building by its code.
 *
 * @param {string} code - building code (e.g. "A", "GRIYA-1")
 * @returns {Promise<Object|null>} building row or null on error/not found
 */
async function getBuildingByCode(code) {
  try {
    const { data, error } = await supabase
      .from(BUILDINGS_TABLE)
      .select('id, name, code, whatsapp_group_jid') // ⚠️ CONFIRM: 'whatsapp_group_jid' column name may differ
      .eq('code', code)
      .maybeSingle();

    if (error) {
      console.error('Error querying building by code:', error);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('Unexpected error in getBuildingByCode:', err);
    return null;
  }
}

/**
 * Looks up a room by its code, including its parent building.
 *
 * @param {string} roomCode - room code (e.g. "A01", "B12")
 * @returns {Promise<Object|null>} room row with building data, or null on error/not found
 */
async function getRoomByCode(roomCode) {
  try {
    const { data, error } = await supabase
      .from(ROOMS_TABLE)
      .select(`
        id,
        code,
        floor,
        is_occupied,
        buildings:building_id (
          id,
          name,
          code,
          whatsapp_group_jid
        )
      `) // ⚠️ CONFIRM: 'floor', 'is_occupied', 'whatsapp_group_jid' column names may differ
      .eq('code', roomCode)
      .maybeSingle();

    if (error) {
      console.error('Error querying room by code:', error);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error('Unexpected error in getRoomByCode:', err);
    return null;
  }
}

module.exports = {
  getBuildingByCode,
  getRoomByCode
};
