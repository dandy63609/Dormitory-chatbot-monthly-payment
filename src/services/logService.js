const supabase = require('../lib/supabaseClient');

let warnedMissingAiLogs = false;
let warnedMissingCommandLogs = false;

function isMissingTableError(error, tableName) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === '42P01' ||
    message.includes(tableName) && (
      message.includes('does not exist') ||
      message.includes('could not find') ||
      message.includes('schema cache')
    )
  );
}

function warnMissingAiLogsOnce() {
  if (warnedMissingAiLogs) return;
  warnedMissingAiLogs = true;
  console.warn('AI usage logging disabled: ai_logs table is missing.');
}

function warnMissingCommandLogsOnce() {
  if (warnedMissingCommandLogs) return;
  warnedMissingCommandLogs = true;
  console.warn('Command logging disabled: command_logs table is missing.');
}

async function logCommand(userId, platform, command) {
  try {
    const payload = {
      user_id: String(userId || '').trim(),
      platform: String(platform || '').toLowerCase().trim(),
      command: String(command || '').toLowerCase().trim()
    };

    if (!payload.user_id || !payload.platform || !payload.command) {
      return;
    }

    const { error } = await supabase.from('command_logs').insert(payload);
    if (error) {
      if (isMissingTableError(error, 'command_logs')) {
        warnMissingCommandLogsOnce();
        return;
      }

      console.error('Failed to write command log:', error.message);
    }
  } catch (error) {
    if (isMissingTableError(error, 'command_logs')) {
      warnMissingCommandLogsOnce();
      return;
    }

    console.error('Unexpected command log error:', error.message);
  }
}

async function logAIUsage(userId, platform, model, prompt, inputTokens, outputTokens) {
  try {
    const payload = {
      user_id: String(userId || '').trim(),
      platform: String(platform || '').toLowerCase().trim(),
      model: String(model || '').trim(),
      prompt: String(prompt || ''),
      input_tokens: Number(inputTokens || 0),
      output_tokens: Number(outputTokens || 0)
    };

    if (!payload.user_id || !payload.platform || !payload.model) {
      return;
    }

    const { error } = await supabase.from('ai_logs').insert(payload);
    if (error) {
      if (isMissingTableError(error, 'ai_logs')) {
        warnMissingAiLogsOnce();
        return;
      }

      console.error('Failed to write AI usage log:', error.message);
    }
  } catch (error) {
    if (isMissingTableError(error, 'ai_logs')) {
      warnMissingAiLogsOnce();
      return;
    }

    console.error('Unexpected AI usage log error:', error.message);
  }
}

module.exports = {
  logCommand,
  logAIUsage
};
