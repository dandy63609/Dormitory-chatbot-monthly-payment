const openrouterClient = require("./openrouterClient");

async function askAi(message, userId, platform, logUserId) {
  return openrouterClient.askAi(message, userId, platform, logUserId);
}

async function askAiDetailed(message, userId, platform, logUserId) {
  return openrouterClient.askAiDetailed(message, userId, platform, logUserId);
}

module.exports = {
  askAi,
  askAiDetailed,
};
