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
      },
      {
        data: new SlashCommandBuilder()
          .setName('wtb')
          .setDescription('WHMCS Ticket Bridge 部門權限管理')
          .addSubcommand(subcommand =>
            subcommand
              .setName('add')
              .setDescription('新增部門身分組權限')
              .addStringOption(option =>
                option.setName('department')
                  .setDescription('選擇部門')
                  .setRequired(true)
                  .setAutocomplete(true))
              .addRoleOption(option =>
                option.setName('role')
                  .setDescription('選擇身分組')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('remove')
              .setDescription('移除部門身分組權限')
              .addStringOption(option =>
                option.setName('department')
                  .setDescription('選擇部門')
                  .setRequired(true)
                  .setAutocomplete(true))
              .addRoleOption(option =>
                option.setName('role')
                  .setDescription('選擇身分組')
                  .setRequired(true)))
          .addSubcommand(subcommand =>
            subcommand
              .setName('list')
              .setDescription('查看部門權限設定')
              .addStringOption(option =>
                option.setName('department')
                  .setDescription('選擇特定部門 (可選)')
                  .setRequired(false)
                  .setAutocomplete(true)))
          .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        execute: this.wtbCommand.bind(this),
        autocomplete: this.wtbAutocomplete.bind(this)
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

  async wtbCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'add') {
        await this.wtbAdd(interaction);
      } else if (subcommand === 'remove') {
        await this.wtbRemove(interaction);
      } else if (subcommand === 'list') {
        await this.wtbList(interaction);
      }
    } catch (error) {
      logger.error('Error in wtb command:', error);
      await interaction.editReply({
        content: `操作失敗: ${error.message}`
      });
    }
  }

  async wtbAdd(interaction) {
    const departmentName = interaction.options.getString('department');
    const role = interaction.options.getRole('role');
    
    // 從部門名稱獲取部門ID
    const departments = await whmcsApi.getSupportDepartments();
    const department = departments.find(d => d.name === departmentName);
    
    if (!department) {
      await interaction.editReply({
        content: `找不到部門: ${departmentName}`
      });
      return;
    }
    
    // 檢查是否已存在相同映射
    const existing = await repository.getDepartmentRoleMapping(department.id, role.id);
    if (existing) {
      await interaction.editReply({
        content: `部門 "${departmentName}" 與身分組 "${role.name}" 的權限映射已存在`
      });
      return;
    }
    
    // 建立新的權限映射
    await repository.createDepartmentRoleMapping({
      whmcsDepartmentId: department.id,
      departmentName: departmentName,
      discordRoleId: role.id,
      discordRoleName: role.name
    });
    
    await interaction.editReply({
      content: `✅ 成功新增權限映射:\n部門: ${departmentName}\n身分組: ${role.name}`
    });
  }

  async wtbRemove(interaction) {
    const departmentName = interaction.options.getString('department');
    const role = interaction.options.getRole('role');
    
    // 從部門名稱獲取部門ID
    const departments = await whmcsApi.getSupportDepartments();
    const department = departments.find(d => d.name === departmentName);
    
    if (!department) {
      await interaction.editReply({
        content: `找不到部門: ${departmentName}`
      });
      return;
    }
    
    // 檢查映射是否存在
    const existing = await repository.getDepartmentRoleMapping(department.id, role.id);
    if (!existing) {
      await interaction.editReply({
        content: `部門 "${departmentName}" 與身分組 "${role.name}" 的權限映射不存在`
      });
      return;
    }
    
    // 刪除權限映射
    const deleted = await repository.deleteDepartmentRoleMapping(department.id, role.id);
    
    if (deleted) {
      await interaction.editReply({
        content: `✅ 成功移除權限映射:\n部門: ${departmentName}\n身分組: ${role.name}`
      });
    } else {
      await interaction.editReply({
        content: `移除權限映射失敗`
      });
    }
  }

  async wtbList(interaction) {
    const departmentName = interaction.options.getString('department');
    
    let mappings;
    if (departmentName) {
      // 查詢特定部門
      const departments = await whmcsApi.getSupportDepartments();
      const department = departments.find(d => d.name === departmentName);
      
      if (!department) {
        await interaction.editReply({
          content: `找不到部門: ${departmentName}`
        });
        return;
      }
      
      mappings = await repository.getDepartmentRoleMappingsByDepartmentId(department.id);
    } else {
      // 查詢所有部門
      mappings = await repository.getAllDepartmentRoleMappings();
    }
    
    if (mappings.length === 0) {
      const scope = departmentName ? `部門 "${departmentName}"` : '系統';
      await interaction.editReply({
        content: `${scope} 沒有設定任何權限映射`
      });
      return;
    }
    
    // 整理顯示格式
    const groupedMappings = {};
    mappings.forEach(mapping => {
      if (!groupedMappings[mapping.departmentName]) {
        groupedMappings[mapping.departmentName] = [];
      }
      groupedMappings[mapping.departmentName].push(mapping.discordRoleName);
    });
    
    let content = '📋 **部門權限設定列表**\n\n';
    Object.entries(groupedMappings).forEach(([dept, roles]) => {
      content += `**${dept}**\n`;
      roles.forEach(roleName => {
        content += `└ ${roleName}\n`;
      });
      content += '\n';
    });
    
    await interaction.editReply({ content });
  }

  async wtbAutocomplete(interaction) {
    try {
      const focusedOption = interaction.options.getFocused(true);
      
      if (focusedOption.name === 'department') {
        const departments = await whmcsApi.getSupportDepartments();
        const filtered = departments
          .filter(dept => dept.name.toLowerCase().includes(focusedOption.value.toLowerCase()))
          .slice(0, 25) // Discord 限制最多 25 個選項
          .map(dept => ({
            name: dept.name,
            value: dept.name
          }));
        
        await interaction.respond(filtered);
      }
    } catch (error) {
      logger.error('Error in wtb autocomplete:', error);
      await interaction.respond([]);
    }
  }

  getCommands() {
    return this.commands;
  }
}

module.exports = new Commands();