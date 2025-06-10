const config = require('../config');
const logger = require('./utils/logger');
const { sequelize } = require('./database/models');
const discordBot = require('./bot/client');
const syncService = require('./sync/sync-service');
const webhookServer = require('./webhooks/server');
const messageHandler = require('./bot/message-handler');
const commands = require('./bot/commands');
const { REST, Routes } = require('discord.js');

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
    logger.info('Starting WHMCS Discord Sync Service...');
    
    await sequelize.authenticate();
    logger.info('Database connection established');
    
    await sequelize.sync();
    logger.info('Database synced');
    
    await discordBot.start();
    logger.info('Discord bot started');
    
    await deployCommands();
    
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
    
    await syncService.syncDepartments();
    logger.info('Departments synced');
    
    await syncService.syncAllTickets();
    logger.info('Initial ticket sync completed');
    
    webhookServer.start();
    logger.info('Webhook server started');
    
    await syncService.startPeriodicSync(config.app.syncInterval);
    logger.info('Periodic sync started');
    
    logger.info('WHMCS Discord Sync Service is running!');
    
    process.on('SIGINT', async () => {
      logger.info('Shutting down...');
      webhookServer.stop();
      await discordBot.getClient().destroy();
      await sequelize.close();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();