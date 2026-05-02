const ALLOWED_AI_PROVIDERS = new Set(["mistral", "openrouter"]);
const DEFAULT_AI_PROVIDER = "mistral";

function getAiProvider() {
  const provider = String(process.env.AI_PROVIDER || DEFAULT_AI_PROVIDER)
    .trim()
    .toLowerCase();

  if (!ALLOWED_AI_PROVIDERS.has(provider)) {
    throw new Error(
      `AI_PROVIDER tidak valid: ${provider}. Gunakan "mistral" atau "openrouter".`,
    );
  }

  return provider;
}

function getProviderClient() {
  const provider = getAiProvider();

  if (provider === "openrouter") {
    console.log("AI provider: openrouter");
    return require("./openrouterClient");
  }

  return require("./mistralClient");
}

async function askAi(message, userId, platform, logUserId) {
  return getProviderClient().askAi(message, userId, platform, logUserId);
}

async function askAiDetailed(message, userId, platform, logUserId) {
  return getProviderClient().askAiDetailed(
    message,
    userId,
    platform,
    logUserId,
  );
}

function getModelName() {
  return getProviderClient().modelName;
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
