const discordBot = require('./client');
const whmcsApi = require('../whmcs/api');
const repository = require('../database/repository');
const TicketFormatter = require('../whmcs/ticket-formatter');
const logger = require('../utils/logger');
const console = require('../utils/console-logger');

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
      
      // 使用 Discord 使用者名稱作為管理員身份
      const adminUsername = `【客服人員】${message.author.username}`;
      
      // 準備訊息內容
      let messageContent = message.content || '';
      let attachments = [];
      
      // 處理附件 - 下載並準備上傳到 WHMCS
      if (message.attachments.size > 0) {
        logger.info(`Processing ${message.attachments.size} attachments for ticket ${ticketMapping.whmcsTicketId}`);
        
        // 允許的檔案類型
        const allowedExtensions = ['.jpg', '.gif', '.jpeg', '.png', '.txt', '.pdf'];
        const maxSize = 2 * 1024 * 1024; // 2MB
        let invalidFiles = [];
        
        for (const attachment of message.attachments.values()) {
          try {
            // 檢查檔案類型
            const fileExtension = attachment.name.toLowerCase().substring(attachment.name.lastIndexOf('.'));
            if (!allowedExtensions.includes(fileExtension)) {
              logger.warn(`Attachment ${attachment.name} has invalid file type: ${fileExtension}`);
              invalidFiles.push(`${attachment.name} (不支援的檔案類型: ${fileExtension})`);
              continue;
            }
            
            // 檢查檔案大小限制
            if (attachment.size > maxSize) {
              logger.warn(`Attachment ${attachment.name} too large (${(attachment.size / 1024 / 1024).toFixed(2)}MB), max allowed is 2MB`);
              invalidFiles.push(`${attachment.name} (檔案過大: ${(attachment.size / 1024 / 1024).toFixed(2)}MB，限制 2MB)`);
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
        
        // 如果有無效檔案，通知客服人員
        if (invalidFiles.length > 0) {
          const warningMsg = await message.channel.send({
            content: `⚠️ **檔案上傳警告**\n以下檔案無法上傳到 WHMCS：\n${invalidFiles.map(f => `• ${f}`).join('\n')}\n\n僅支援: ${allowedExtensions.join(', ')} 格式，最大 2MB`,
            reply: { messageReference: message.id }
          });
          setTimeout(() => warningMsg.delete(), 10000); // 10秒後刪除警告訊息
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
      
      console.log(`✉️  Synced Discord message to WHMCS ticket ${ticketMapping.whmcsTicketId}`);
      logger.info(`Synced Discord message to WHMCS ticket ${ticketMapping.whmcsTicketId}`);
    } catch (error) {
      console.error(`❌ Failed to sync reply to ticket ${ticketMapping.whmcsTicketId}: ${error.message}`);
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