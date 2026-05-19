// Application settings
// TODO: Load from environment and define defaults

const path = require("path");

const settings = {
  app: {
    name: "Martinos Kos Assistant",
    version: "1.0.0",
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || "development",
  },

  whatsapp: {
    sessionDir:
      process.env.WA_SESSION_DIR || path.join(__dirname, "../../auth/whatsapp"),
    phoneNumber: process.env.WA_PHONE_NUMBER,
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
  },

  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_PUBLISHABLE_KEY,
  },

  monitor: {
    url: process.env.MONITOR_URL,
    interval: parseInt(process.env.MONITOR_INTERVAL) || 300000,
  },

  paths: {
    temp: path.join(__dirname, "../../temp"),
  },
};

module.exports = settings;
