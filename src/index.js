const config = require('../config');
const logger = require('./utils/logger');
const { sequelize } = require('./database/models');
const discordBot = require('./bot/client');
const syncService = require('./sync/sync-service');
const webhookServer = require('./webhooks/server');
const messageHandler = require('./bot/message-handler');
const commands = require('./bot/commands');
const { REST, Routes } = require('discord.js');

// 創建帶時間戳的控制台輸出函數
const getTimestamp = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const consoleWithLogger = {
  log: (message) => {
    console.log(`${getTimestamp()} info: ${message}`);
    logger.info(message);
  },
  error: (message) => {
    console.error(`${getTimestamp()} error: ${message}`);
    logger.error(message);
  },
  warn: (message) => {
    console.warn(`${getTimestamp()} warn: ${message}`);
    logger.warn(message);
  }
};

async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    
    logger.info('Started refreshing application (/) commands.');
    
    await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
      { body: commands.getCommands().map(cmd => cmd.data.toJSON()) }
    );
    
    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error('Error deploying commands:', error);
  }
}

async function start() {
  try {
    consoleWithLogger.log('========================================');
    consoleWithLogger.log('🚀 Starting WHMCS Discord Sync Service...');
    consoleWithLogger.log('========================================');
    
    consoleWithLogger.log('📊 Connecting to database...');
    await sequelize.authenticate();
    consoleWithLogger.log('✅ Database connection established');
    
    await sequelize.sync();
    consoleWithLogger.log('✅ Database synced');
    
    consoleWithLogger.log('🤖 Starting Discord bot...');
    await discordBot.start();
    consoleWithLogger.log('✅ Discord bot started');
    
    consoleWithLogger.log('📝 Deploying slash commands...');
    await deployCommands();
    consoleWithLogger.log('✅ Commands deployed');
    
    const client = discordBot.getClient();
    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      
      const command = commands.getCommands().find(cmd => cmd.data.name === interaction.commandName);
      
      if (!command) return;
      
      try {
        await command.execute(interaction);
      } catch (error) {
        logger.error(`Error executing command ${interaction.commandName}:`, error);
        await interaction.reply({ 
          content: 'There was an error while executing this command!', 
          ephemeral: true 
        });
      }
    });
    
    consoleWithLogger.log('🏢 Syncing WHMCS departments...');
    await syncService.syncDepartments();
    consoleWithLogger.log('✅ Departments synced');
    
    consoleWithLogger.log('🎫 Starting initial ticket sync...');
    const syncedCount = await syncService.syncAllTickets();
    consoleWithLogger.log(`✅ Initial sync completed: ${syncedCount} tickets synced`);
    
    consoleWithLogger.log('🌐 Starting webhook server on port 3000...');
    webhookServer.start();
    consoleWithLogger.log('✅ Webhook server started');
    
    consoleWithLogger.log(`⏰ Starting periodic sync (every ${config.app.syncInterval/1000} seconds)...`);
    await syncService.startPeriodicSync(config.app.syncInterval);
    consoleWithLogger.log('✅ Periodic sync started');
    
    consoleWithLogger.log('========================================');
    consoleWithLogger.log('✨ WHMCS Discord Sync Service is ready!');
    consoleWithLogger.log('========================================');
    consoleWithLogger.log(`📌 Bot: ${client.user.tag}`);
    consoleWithLogger.log(`📌 Guild: ${config.discord.guildId}`);
    consoleWithLogger.log(`📌 Webhook: http://localhost:3000/webhook`);
    consoleWithLogger.log('========================================');
    
    process.on('SIGINT', async () => {
      consoleWithLogger.log('\n⚠️  Shutting down gracefully...');
      webhookServer.stop();
      await discordBot.getClient().destroy();
      await sequelize.close();
      consoleWithLogger.log('✅ Shutdown complete');
      process.exit(0);
    });
    
  } catch (error) {
    consoleWithLogger.error(`❌ Failed to start service: ${error.message}`);
    process.exit(1);
  }
}

start();