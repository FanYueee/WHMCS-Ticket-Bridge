const discordBot = require('./client');
const whmcsApi = require('../whmcs/api');
const repository = require('../database/repository');
const TicketFormatter = require('../whmcs/ticket-formatter');
const logger = require('../utils/logger');

class MessageHandler {
  constructor() {
    this.setupHandlers();
  }

  setupHandlers() {
    const client = discordBot.getClient();
    
    client.on('messageCreate', async (message) => {
      try {
        if (message.author.bot) return;
        
        if (!message.guild || message.guild.id !== discordBot.getGuild().id) return;
        
        const ticketMapping = await repository.getTicketMappingByChannelId(message.channel.id);
        if (!ticketMapping) return;
        
        const member = await message.guild.members.fetch(message.author.id);
        if (!discordBot.isStaffMember(member)) {
          await message.delete();
          const warning = await message.channel.send('Only staff members can reply to tickets.');
          setTimeout(() => warning.delete(), 5000);
          return;
        }
        
        await this.handleStaffReply(message, ticketMapping);
      } catch (error) {
        logger.error('Error handling message:', error);
      }
    });

    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;
      
      try {
        await this.handleButtonInteraction(interaction);
      } catch (error) {
        logger.error('Error handling button interaction:', error);
        await interaction.reply({ 
          content: 'An error occurred while processing your request.', 
          ephemeral: true 
        });
      }
    });
  }

  async handleStaffReply(message, ticketMapping) {
    try {
      await message.channel.sendTyping();
      
      // 檢查是否有內部 ID 用於 API 調用
      if (!ticketMapping.whmcsInternalId) {
        logger.error(`Missing internal ID for ticket ${ticketMapping.whmcsTicketId}`);
        await message.react('❌');
        const errorMsg = await message.channel.send('Unable to sync reply: Missing ticket internal ID.');
        setTimeout(() => errorMsg.delete(), 5000);
        return;
      }
      
      // 嘗試獲取管理員資訊，如果失敗則使用預設值
      let adminUsername = 'admin'; // 預設管理員名稱
      try {
        const adminUsers = await whmcsApi.getAdminUsers();
        const adminUser = adminUsers.find(admin => 
          admin.email === message.author.tag || 
          admin.username === message.author.username ||
          admin.email.includes(message.author.username)
        );
        if (adminUser) {
          adminUsername = adminUser.username;
        }
      } catch (adminError) {
        logger.warn('Failed to get admin users, using default admin username:', adminError.message);
        // 繼續使用預設的 adminUsername
      }
      
      // 準備訊息內容
      let messageContent = message.content || '';
      let attachments = [];
      
      // 處理附件 - 下載並準備上傳到 WHMCS
      if (message.attachments.size > 0) {
        logger.info(`Processing ${message.attachments.size} attachments for ticket ${ticketMapping.whmcsTicketId}`);
        
        for (const attachment of message.attachments.values()) {
          try {
            // 檢查檔案大小限制 (例如 10MB)
            const maxSize = 10 * 1024 * 1024; // 10MB
            if (attachment.size > maxSize) {
              logger.warn(`Attachment ${attachment.name} too large (${attachment.size} bytes), adding as link instead`);
              if (messageContent) {
                messageContent += '\n\n';
              }
              messageContent += `📎 ${attachment.name} (檔案過大，請使用連結下載: ${attachment.url})`;
              continue;
            }
            
            // 下載附件
            logger.info(`Downloading attachment: ${attachment.name} (${attachment.size} bytes)`);
            const axios = require('axios');
            const response = await axios.get(attachment.url, {
              responseType: 'arraybuffer',
              timeout: 30000 // 30秒超時
            });
            
            // 轉換為 base64
            const fileData = Buffer.from(response.data).toString('base64');
            
            attachments.push({
              name: attachment.name,
              data: fileData
            });
            
            logger.info(`Successfully processed attachment: ${attachment.name}`);
          } catch (attachmentError) {
            logger.error(`Error processing attachment ${attachment.name}:`, attachmentError);
            // 如果下載失敗，改為添加連結
            if (messageContent) {
              messageContent += '\n\n';
            }
            messageContent += `📎 ${attachment.name} (下載失敗，請使用連結: ${attachment.url})`;
          }
        }
        
        // 如果有成功處理的附件，在訊息中提及
        if (attachments.length > 0) {
          if (messageContent) {
            messageContent += '\n\n';
          }
          messageContent += `📎 已附加 ${attachments.length} 個檔案`;
        }
      }
      
      // 確保有內容可以發送
      if (!messageContent.trim() && attachments.length === 0) {
        logger.warn('Empty message content and no attachments, skipping sync');
        await message.react('⚠️');
        return;
      }
      
      // 如果沒有文字內容但有附件，提供預設訊息
      if (!messageContent.trim() && attachments.length > 0) {
        messageContent = `已上傳 ${attachments.length} 個檔案`;
      }
      
      // 使用內部 ID 進行 API 調用
      const response = await whmcsApi.addTicketReply(
        ticketMapping.whmcsInternalId,  // 使用內部數字 ID
        messageContent,
        '',
        adminUsername,
        attachments  // 傳遞附件陣列
      );
      
      await repository.createMessageSync({
        whmcsTicketId: ticketMapping.whmcsTicketId,
        whmcsReplyId: response.replyid,
        discordMessageId: message.id,
        direction: 'discord_to_whmcs'
      });
      
      await message.react('✅');
      
      logger.info(`Synced Discord message to WHMCS ticket ${ticketMapping.whmcsTicketId}`);
    } catch (error) {
      logger.error('Error syncing reply to WHMCS:', error);
      await message.react('❌');
      const errorMsg = await message.channel.send('Failed to sync reply to WHMCS.');
      setTimeout(() => errorMsg.delete(), 5000);
    }
  }

  async handleButtonInteraction(interaction) {
    const [action, ticketId] = interaction.customId.split('_');
    
    switch (action) {
      case 'close':
        await this.handleCloseTicket(interaction, ticketId);
        break;
      case 'reopen':
        await this.handleReopenTicket(interaction, ticketId);
        break;
      case 'hold':
        await this.handleHoldTicket(interaction, ticketId);
        break;
      default:
        await interaction.reply({ 
          content: 'Unknown action.', 
          ephemeral: true 
        });
    }
  }

  async handleCloseTicket(interaction, ticketId) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!discordBot.isStaffMember(member)) {
        await interaction.reply({ 
          content: 'Only staff members can close tickets.', 
          ephemeral: true 
        });
        return;
      }
      
      const ticketMapping = await repository.getTicketMappingByWhmcsId(ticketId);
      if (ticketMapping && ticketMapping.whmcsInternalId) {
        await whmcsApi.updateTicket(ticketMapping.whmcsInternalId, { status: 'Closed' });
        await repository.updateTicketMapping(ticketId, { status: 'Closed' });
        await discordBot.archiveChannel(ticketMapping.discordChannelId);
      } else {
        throw new Error('Ticket mapping not found or missing internal ID');
      }
      
      await interaction.reply({ 
        content: `Ticket #${ticketId} has been closed.`, 
        ephemeral: true 
      });
    } catch (error) {
      logger.error('Error closing ticket:', error);
      throw error;
    }
  }

  async handleReopenTicket(interaction, ticketId) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!discordBot.isStaffMember(member)) {
        await interaction.reply({ 
          content: 'Only staff members can reopen tickets.', 
          ephemeral: true 
        });
        return;
      }
      
      await whmcsApi.updateTicket(ticketId, { status: 'Open' });
      
      await repository.updateTicketMapping(ticketId, { status: 'Open' });
      
      await interaction.reply({ 
        content: `Ticket #${ticketId} has been reopened.`, 
        ephemeral: true 
      });
    } catch (error) {
      logger.error('Error reopening ticket:', error);
      throw error;
    }
  }

  async handleHoldTicket(interaction, ticketId) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!discordBot.isStaffMember(member)) {
        await interaction.reply({ 
          content: 'Only staff members can put tickets on hold.', 
          ephemeral: true 
        });
        return;
      }
      
      await whmcsApi.updateTicket(ticketId, { status: 'On Hold' });
      
      await repository.updateTicketMapping(ticketId, { status: 'On Hold' });
      
      await interaction.reply({ 
        content: `Ticket #${ticketId} has been put on hold.`, 
        ephemeral: true 
      });
    } catch (error) {
      logger.error('Error putting ticket on hold:', error);
      throw error;
    }
  }
}

module.exports = new MessageHandler();