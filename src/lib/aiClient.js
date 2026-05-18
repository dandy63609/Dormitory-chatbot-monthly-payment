const openrouterClient = require("./openrouterClient");

function getAiProvider() {
  return "openrouter";
}

async function askAi(message, userId, platform, logUserId) {
  return openrouterClient.askAi(message, userId, platform, logUserId);
}

async function askAiDetailed(message, userId, platform, logUserId) {
  return openrouterClient.askAiDetailed(message, userId, platform, logUserId);
}

function getModelName() {
  return openrouterClient.modelName;
}

module.exports = {
  askAi,
  askAiDetailed,
  getAiProvider,
  getModelName,
  get modelName() {
    return getModelName();
  },
};
