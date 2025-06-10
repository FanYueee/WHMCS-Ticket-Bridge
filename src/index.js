const config = require('../config');
const logger = require('./utils/logger');
const { sequelize } = require('./database/models');
const discordBot = require('./bot/client');
const syncService = require('./sync/sync-service');
const webhookServer = require('./webhooks/server');
const messageHandler = require('./bot/message-handler');
const commands = require('./bot/commands');
const { REST, Routes } = require('discord.js');
const console = require('./utils/console-logger');

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
    console.log('========================================');
    console.log('🚀 Starting WHMCS Discord Sync Service...');
    console.log('========================================');
    logger.info('Starting WHMCS Discord Sync Service...');
    
    console.log('📊 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    logger.info('Database connection established');
    
    await sequelize.sync();
    console.log('✅ Database synced');
    logger.info('Database synced');
    
    console.log('🤖 Starting Discord bot...');
    await discordBot.start();
    console.log('✅ Discord bot started');
    logger.info('Discord bot started');
    
    console.log('📝 Deploying slash commands...');
    await deployCommands();
    console.log('✅ Commands deployed');
    
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
    
    console.log('🏢 Syncing WHMCS departments...');
    await syncService.syncDepartments();
    console.log('✅ Departments synced');
    logger.info('Departments synced');
    
    console.log('🎫 Starting initial ticket sync...');
    const syncedCount = await syncService.syncAllTickets();
    console.log(`✅ Initial sync completed: ${syncedCount} tickets synced`);
    logger.info('Initial ticket sync completed');
    
    console.log('🌐 Starting webhook server on port 3000...');
    webhookServer.start();
    console.log('✅ Webhook server started');
    logger.info('Webhook server started');
    
    console.log(`⏰ Starting periodic sync (every ${config.app.syncInterval/1000} seconds)...`);
    await syncService.startPeriodicSync(config.app.syncInterval);
    console.log('✅ Periodic sync started');
    logger.info('Periodic sync started');
    
    console.log('========================================');
    console.log('✨ WHMCS Discord Sync Service is ready!');
    console.log('========================================');
    console.log(`📌 Bot: ${client.user.tag}`);
    console.log(`📌 Guild: ${config.discord.guildId}`);
    console.log(`📌 Webhook: http://localhost:3000/webhook`);
    console.log('========================================');
    logger.info('WHMCS Discord Sync Service is running!');
    
    process.on('SIGINT', async () => {
      console.log('\n⚠️  Shutting down gracefully...');
      logger.info('Shutting down...');
      webhookServer.stop();
      await discordBot.getClient().destroy();
      await sequelize.close();
      console.log('✅ Shutdown complete');
      process.exit(0);
    });
    
  } catch (error) {
    console.error(`❌ Failed to start service: ${error.message}`);
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();