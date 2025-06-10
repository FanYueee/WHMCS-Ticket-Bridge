require('dotenv').config();

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    staffRoleId: process.env.DISCORD_STAFF_ROLE_ID
  },
  whmcs: {
    apiUrl: process.env.WHMCS_API_URL,
    apiIdentifier: process.env.WHMCS_API_IDENTIFIER,
    apiSecret: process.env.WHMCS_API_SECRET
  },
  database: {
    type: process.env.DB_TYPE || 'sqlite',
    path: process.env.DB_PATH || './database/sync.db'
  },
  webhook: {
    secret: process.env.WEBHOOK_SECRET,
    port: process.env.WEBHOOK_PORT || 3000
  },
  app: {
    logLevel: process.env.LOG_LEVEL || 'info',
    nodeEnv: process.env.NODE_ENV || 'development',
    syncInterval: parseInt(process.env.SYNC_INTERVAL || '300000')
  }
};