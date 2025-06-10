const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const whmcsApi = require('../whmcs/api');
const repository = require('../database/repository');
const logger = require('../utils/logger');

class Commands {
  constructor() {
    this.commands = [
      {
        data: new SlashCommandBuilder()
          .setName('syncticket')
          .setDescription('Manually sync a specific WHMCS ticket')
          .addIntegerOption(option =>
            option.setName('ticketid')
              .setDescription('The WHMCS ticket ID to sync')
              .setRequired(true)
          )
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
        execute: this.syncTicket.bind(this)
      },
      {
        data: new SlashCommandBuilder()
          .setName('syncall')
          .setDescription('Sync all open tickets from WHMCS')
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        execute: this.syncAll.bind(this)
      },
      {
        data: new SlashCommandBuilder()
          .setName('ticketinfo')
          .setDescription('Get information about the current ticket channel')
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
        execute: this.ticketInfo.bind(this)
      },
      {
        data: new SlashCommandBuilder()
          .setName('assignticket')
          .setDescription('Assign this ticket to a specific admin')
          .addStringOption(option =>
            option.setName('admin')
              .setDescription('The admin username to assign')
              .setRequired(true)
          )
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
        execute: this.assignTicket.bind(this)
      },
      {
        data: new SlashCommandBuilder()
          .setName('priority')
          .setDescription('Change ticket priority')
          .addStringOption(option =>
            option.setName('level')
              .setDescription('The new priority level')
              .setRequired(true)
              .addChoices(
                { name: 'Low', value: 'Low' },
                { name: 'Medium', value: 'Medium' },
                { name: 'High', value: 'High' },
                { name: 'Urgent', value: 'Urgent' }
              )
          )
          .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
        execute: this.changePriority.bind(this)
      }
    ];
  }

  async syncTicket(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const ticketId = interaction.options.getInteger('ticketid');
      const syncService = require('../sync/sync-service');
      
      await syncService.syncSingleTicket(ticketId);
      
      await interaction.editReply({
        content: `Successfully synced ticket #${ticketId}`
      });
    } catch (error) {
      logger.error('Error in syncticket command:', error);
      await interaction.editReply({
        content: `Failed to sync ticket: ${error.message}`
      });
    }
  }

  async syncAll(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const syncService = require('../sync/sync-service');
      const count = await syncService.syncAllTickets();
      
      await interaction.editReply({
        content: `Successfully synced ${count} tickets from WHMCS`
      });
    } catch (error) {
      logger.error('Error in syncall command:', error);
      await interaction.editReply({
        content: `Failed to sync tickets: ${error.message}`
      });
    }
  }

  async ticketInfo(interaction) {
    try {
      const ticketMapping = await repository.getTicketMappingByChannelId(interaction.channel.id);
      
      if (!ticketMapping) {
        await interaction.reply({
          content: 'This channel is not linked to a WHMCS ticket.',
          ephemeral: true
        });
        return;
      }
      
      const ticket = await whmcsApi.getTicket(ticketMapping.whmcsTicketId);
      
      await interaction.reply({
        content: `**Ticket Information**\n` +
          `Ticket ID: ${ticket.tid}\n` +
          `Subject: ${ticket.subject}\n` +
          `Status: ${ticket.status}\n` +
          `Priority: ${ticket.priority}\n` +
          `Department: ${ticket.deptname}\n` +
          `Last Updated: ${ticket.lastreply || ticket.date}`,
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error in ticketinfo command:', error);
      await interaction.reply({
        content: 'Failed to retrieve ticket information.',
        ephemeral: true
      });
    }
  }

  async assignTicket(interaction) {
    try {
      const ticketMapping = await repository.getTicketMappingByChannelId(interaction.channel.id);
      
      if (!ticketMapping) {
        await interaction.reply({
          content: 'This channel is not linked to a WHMCS ticket.',
          ephemeral: true
        });
        return;
      }
      
      const adminUsername = interaction.options.getString('admin');
      
      await whmcsApi.updateTicket(ticketMapping.whmcsTicketId, {
        flag: adminUsername
      });
      
      await interaction.reply({
        content: `Ticket assigned to ${adminUsername}`,
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error in assignticket command:', error);
      await interaction.reply({
        content: 'Failed to assign ticket.',
        ephemeral: true
      });
    }
  }

  async changePriority(interaction) {
    try {
      const ticketMapping = await repository.getTicketMappingByChannelId(interaction.channel.id);
      
      if (!ticketMapping) {
        await interaction.reply({
          content: 'This channel is not linked to a WHMCS ticket.',
          ephemeral: true
        });
        return;
      }
      
      const priority = interaction.options.getString('level');
      
      await whmcsApi.updateTicket(ticketMapping.whmcsTicketId, {
        priority: priority
      });
      
      await repository.updateTicketMapping(ticketMapping.whmcsTicketId, {
        priority: priority
      });
      
      const TicketFormatter = require('../whmcs/ticket-formatter');
      const newChannelName = TicketFormatter.formatChannelName(
        priority,
        ticketMapping.departmentName,
        ticketMapping.whmcsTicketId
      );
      
      const discordBot = require('./client');
      await discordBot.updateChannelName(interaction.channel.id, newChannelName);
      
      await interaction.reply({
        content: `Ticket priority changed to ${priority}`,
        ephemeral: true
      });
    } catch (error) {
      logger.error('Error in changepriority command:', error);
      await interaction.reply({
        content: 'Failed to change priority.',
        ephemeral: true
      });
    }
  }

  getCommands() {
    return this.commands;
  }
}

module.exports = new Commands();