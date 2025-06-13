const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('../../config');
const logger = require('../utils/logger');

class DiscordBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.User
      ]
    });

    this.guild = null;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.once('ready', () => {
      logger.info(`Discord bot logged in as ${this.client.user.tag}`);
      this.guild = this.client.guilds.cache.get(config.discord.guildId);
      
      if (!this.guild) {
        logger.error(`Could not find guild with ID ${config.discord.guildId}`);
        process.exit(1);
      }
      
      logger.info(`Connected to guild: ${this.guild.name}`);
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error:', error);
    });

    this.client.on('warn', (warning) => {
      logger.warn('Discord client warning:', warning);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isAutocomplete()) {
        const commands = require('./commands');
        const commandMap = new Map();
        commands.getCommands().forEach(cmd => {
          commandMap.set(cmd.data.name, cmd);
        });
        
        const command = commandMap.get(interaction.commandName);
        if (command && command.autocomplete) {
          try {
            await command.autocomplete(interaction);
          } catch (error) {
            logger.error('Error handling autocomplete:', error);
          }
        }
      }
    });
  }

  async start() {
    try {
      await this.client.login(config.discord.token);
    } catch (error) {
      logger.error('Failed to start Discord bot:', error);
      throw error;
    }
  }

  async createCategory(name) {
    try {
      const category = await this.guild.channels.create({
        name: name,
        type: 4, // ChannelType.GuildCategory
        permissionOverwrites: [
          {
            id: this.guild.id,
            deny: ['ViewChannel']
          },
          {
            id: config.discord.staffRoleId,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels']
          }
        ]
      });
      
      logger.info(`Created category: ${category.name}`);
      return category;
    } catch (error) {
      logger.error('Error creating category:', error);
      throw error;
    }
  }

  async createTicketChannel(categoryId, channelName, topic = '', departmentRoles = []) {
    try {
      if (!this.guild) {
        throw new Error('Discord bot is not connected to any guild');
      }
      
      // 基本權限設定
      const permissionOverwrites = [
        {
          id: this.guild.id,
          deny: ['ViewChannel']
        },
        {
          id: config.discord.staffRoleId,
          allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages']
        }
      ];
      
      // 添加部門特定角色權限
      departmentRoles.forEach(roleId => {
        permissionOverwrites.push({
          id: roleId,
          allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages']
        });
      });
      
      const channel = await this.guild.channels.create({
        name: channelName,
        type: 0, // ChannelType.GuildText
        parent: categoryId,
        topic: topic,
        permissionOverwrites: permissionOverwrites
      });
      
      logger.info(`Created ticket channel: ${channel.name} with ${departmentRoles.length} department roles`);
      return channel;
    } catch (error) {
      logger.error('Error creating ticket channel:', error);
      throw error;
    }
  }

  async getCategoryByName(name) {
    return this.guild.channels.cache.find(
      channel => channel.type === 4 && channel.name === name
    );
  }

  async getChannel(channelId) {
    try {
      if (!this.guild) {
        logger.error(`Discord bot is not connected to any guild when trying to fetch channel ${channelId}`);
        return null;
      }
      
      return await this.guild.channels.fetch(channelId);
    } catch (error) {
      logger.error(`Error fetching channel ${channelId}:`, error);
      return null;
    }
  }

  async sendMessage(channelId, content) {
    try {
      const channel = await this.getChannel(channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }
      
      return await channel.send(content);
    } catch (error) {
      logger.error(`Error sending message to channel ${channelId}:`, error);
      throw error;
    }
  }

  async updateChannelName(channelId, newName) {
    try {
      const channel = await this.getChannel(channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }
      
      await channel.setName(newName);
      logger.info(`Updated channel name to: ${newName}`);
    } catch (error) {
      logger.error(`Error updating channel name:`, error);
      throw error;
    }
  }

  async updateChannelTopic(channelId, newTopic) {
    try {
      const channel = await this.getChannel(channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }
      
      await channel.setTopic(newTopic);
      logger.info(`Updated channel topic`);
    } catch (error) {
      logger.error(`Error updating channel topic:`, error);
      throw error;
    }
  }

  async archiveChannel(channelId) {
    try {
      const channel = await this.getChannel(channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }
      
      await channel.permissionOverwrites.edit(this.guild.id, {
        ViewChannel: false,
        SendMessages: false
      });
      
      await channel.setName(`archived-${channel.name}`);
      logger.info(`Archived channel: ${channel.name}`);
    } catch (error) {
      logger.error(`Error archiving channel:`, error);
      throw error;
    }
  }

  async deleteChannel(channelId) {
    try {
      const channel = await this.getChannel(channelId);
      if (!channel) {
        logger.warn(`Channel ${channelId} not found for deletion`);
        return;
      }
      
      const channelName = channel.name;
      await channel.delete();
      logger.info(`Deleted channel: ${channelName}`);
    } catch (error) {
      logger.error(`Error deleting channel ${channelId}:`, error);
      throw error;
    }
  }

  isStaffMember(member) {
    return member.roles.cache.has(config.discord.staffRoleId);
  }

  getClient() {
    return this.client;
  }

  getGuild() {
    return this.guild;
  }
}

module.exports = new DiscordBot();