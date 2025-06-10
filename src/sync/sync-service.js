const whmcsApi = require('../whmcs/api');
const discordBot = require('../bot/client');
const repository = require('../database/repository');
const TicketFormatter = require('../whmcs/ticket-formatter');
const logger = require('../utils/logger');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class SyncService {
  async syncDepartments() {
    try {
      const departments = await whmcsApi.getSupportDepartments();
      
      for (const dept of departments) {
        const existingMapping = await repository.getDepartmentMappingByWhmcsId(dept.id);
        
        if (!existingMapping) {
          const categoryName = TicketFormatter.formatCategoryName(dept.name);
          const existingCategory = await discordBot.getCategoryByName(categoryName);
          
          let category;
          if (existingCategory) {
            category = existingCategory;
          } else {
            category = await discordBot.createCategory(categoryName);
          }
          
          await repository.createDepartmentMapping({
            whmcsDepartmentId: dept.id,
            departmentName: dept.name,
            discordCategoryId: category.id
          });
          
          logger.info(`Mapped department ${dept.name} to Discord category ${category.name}`);
        }
      }
    } catch (error) {
      logger.error('Error syncing departments:', error);
      throw error;
    }
  }

  async syncSingleTicket(ticketId) {
    try {
      const ticket = await whmcsApi.getTicket(ticketId);
      
      const existingMapping = await repository.getTicketMappingByWhmcsId(ticketId);
      
      if (existingMapping) {
        await this.updateExistingTicket(ticket, existingMapping);
      } else {
        await this.createNewTicketChannel(ticket);
      }
      
      await this.syncTicketReplies(ticket);
    } catch (error) {
      if (error.message === 'Ticket ID Not Found') {
        logger.warn(`Ticket ${ticketId} not found in WHMCS, cleaning up mapping`);
        const existingMapping = await repository.getTicketMappingByWhmcsId(ticketId);
        if (existingMapping) {
          await repository.deleteTicketMapping(ticketId);
          logger.info(`Cleaned up mapping for non-existent ticket ${ticketId}`);
        }
        return; // 不要拋出錯誤，繼續處理其他票務
      }
      logger.error(`Error syncing ticket ${ticketId}:`, error);
      throw error;
    }
  }

  async createNewTicketChannel(ticket) {
    try {
      const departmentMapping = await repository.getDepartmentMappingByWhmcsId(ticket.deptid);
      
      if (!departmentMapping) {
        await this.syncDepartments();
        const updatedMapping = await repository.getDepartmentMappingByWhmcsId(ticket.deptid);
        if (!updatedMapping) {
          throw new Error(`Department ${ticket.deptname} not found`);
        }
        
        // 重新檢查票務映射，避免重複創建
        const existingTicketMapping = await repository.getTicketMappingByWhmcsId(ticket.tid);
        if (existingTicketMapping) {
          logger.info(`Ticket ${ticket.tid} mapping already exists, skipping creation`);
          return;
        }
        
        // 使用更新後的部門映射繼續創建
        return this.createNewTicketChannelWithMapping(ticket, updatedMapping);
      }
      
      return this.createNewTicketChannelWithMapping(ticket, departmentMapping);
    } catch (error) {
      logger.error('Error creating ticket channel:', error);
      throw error;
    }
  }

  async createNewTicketChannelWithMapping(ticket, departmentMapping) {
    try {
      // 再次檢查票務映射是否已存在，防止競態條件
      const existingMapping = await repository.getTicketMappingByWhmcsId(ticket.tid);
      if (existingMapping) {
        logger.info(`Ticket ${ticket.tid} mapping already exists during channel creation, skipping`);
        return;
      }
      
      const channelName = TicketFormatter.formatChannelName(
        ticket.priority || 'Medium',
        ticket.deptname,
        ticket.tid
      );
      
      const channel = await discordBot.createTicketChannel(
        departmentMapping.discordCategoryId,
        channelName,
        `WHMCS Ticket #${ticket.tid} - ${ticket.subject}`
      );
      
      // 修復客戶詳情獲取，只在有 userid 且非空時才調用
      let client = null;
      if (ticket.userid && ticket.userid !== '' && ticket.userid !== '0') {
        try {
          client = await whmcsApi.getClient(ticket.userid);
        } catch (error) {
          logger.warn(`Failed to get client details for user ${ticket.userid}:`, error.message);
          client = null;
        }
      }
      
      const ticketEmbed = TicketFormatter.createTicketEmbed(ticket, client);
      
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`close_${ticket.tid}`)
            .setLabel('Close Ticket')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒'),
          new ButtonBuilder()
            .setCustomId(`hold_${ticket.tid}`)
            .setLabel('Put On Hold')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏸️')
        );
      
      await channel.send({ 
        embeds: [ticketEmbed], 
        components: [actionRow] 
      });
      
      await repository.createTicketMapping({
        whmcsTicketId: ticket.tid,
        whmcsInternalId: ticket.internalId || ticket.id || ticket.ticketid,
        discordChannelId: channel.id,
        discordCategoryId: departmentMapping.discordCategoryId,
        departmentId: ticket.deptid,
        departmentName: ticket.deptname,
        priority: ticket.priority || 'Medium',
        status: ticket.status
      });
      
      logger.info(`Created Discord channel for ticket ${ticket.tid}`);
    } catch (error) {
      logger.error('Error creating ticket channel with mapping:', error);
      throw error;
    }
  }

  async updateExistingTicket(ticket, mapping) {
    try {
      if (mapping.status !== ticket.status) {
        const channel = await discordBot.getChannel(mapping.discordChannelId);
        
        if (channel) {
          const statusEmbed = TicketFormatter.createStatusUpdateEmbed(
            ticket.tid,
            mapping.status,
            ticket.status
          );
          
          await channel.send({ embeds: [statusEmbed] });
          
          if (ticket.status === 'Closed') {
            await discordBot.archiveChannel(mapping.discordChannelId);
          }
        }
      }
      
      if (mapping.priority !== ticket.priority) {
        const newChannelName = TicketFormatter.formatChannelName(
          ticket.priority,
          mapping.departmentName,
          ticket.tid
        );
        
        await discordBot.updateChannelName(mapping.discordChannelId, newChannelName);
      }
      
      await repository.updateTicketMapping(ticket.tid, {
        status: ticket.status,
        priority: ticket.priority,
        lastSyncedAt: new Date()
      });
    } catch (error) {
      logger.error('Error updating existing ticket:', error);
      throw error;
    }
  }

  async syncTicketReplies(ticket) {
    try {
      const mapping = await repository.getTicketMappingByWhmcsId(ticket.tid);
      if (!mapping) return;
      
      const channel = await discordBot.getChannel(mapping.discordChannelId);
      if (!channel) return;
      
      const replies = ticket.replies?.reply || [];
      
      for (const reply of replies) {
        if (!reply.id) {
          logger.warn('Reply missing ID, skipping sync');
          continue;
        }
        
        const existingSync = await repository.getMessageSyncByWhmcsReplyId(reply.id);
        
        if (!existingSync) {
          const isAdmin = reply.admin !== '';
          const replyEmbed = TicketFormatter.createReplyEmbed(reply, isAdmin);
          
          const message = await channel.send({ embeds: [replyEmbed] });
          
          await repository.createMessageSync({
            whmcsTicketId: ticket.tid,
            whmcsReplyId: reply.id,
            discordMessageId: message.id,
            direction: 'whmcs_to_discord'
          });
          
          logger.info(`Synced reply ${reply.id} from WHMCS to Discord`);
        }
      }
    } catch (error) {
      logger.error('Error syncing ticket replies:', error);
      throw error;
    }
  }

  async syncAllTickets() {
    try {
      await this.syncDepartments();
      
      const tickets = await whmcsApi.getTickets();
      let syncedCount = 0;
      
      logger.info(`Found ${tickets.length} tickets from WHMCS API`);
      
      for (const ticketSummary of tickets) {
        if (['Open', 'Answered', 'Customer-Reply'].includes(ticketSummary.status)) {
          // 使用 tid (票務號碼) 而不是 id (內部數字 ID)
          const ticketId = ticketSummary.tid || ticketSummary.id;
          
          // 檢查是否已經有對應的映射
          const existingMapping = await repository.getTicketMappingByWhmcsId(ticketId);
          
          if (!existingMapping) {
            // 先驗證票務是否真的存在，再創建頻道
            logger.info(`Checking accessibility of new ticket ${ticketId}`);
            try {
              const ticketDetails = await whmcsApi.getTicket(ticketId);
              logger.info(`Ticket ${ticketId} is accessible, creating channel`);
              
              // 將列表中的內部 ID 添加到票務詳情中
              ticketDetails.internalId = ticketSummary.id || ticketSummary.ticketid;
              
              // 直接調用創建頻道的邏輯，避免重複的 API 調用
              await this.createNewTicketChannel(ticketDetails);
              await this.syncTicketReplies(ticketDetails);
              syncedCount++;
            } catch (error) {
              if (error.message === 'Ticket ID Not Found') {
                logger.warn(`Ticket ${ticketId} found in list but not accessible, skipping`);
              } else {
                logger.error(`Error processing ticket ${ticketId}:`, error);
                // 不要拋出錯誤，繼續處理其他票務
              }
            }
          } else {
            logger.debug(`Ticket ${ticketId} already has mapping, skipping initial sync`);
          }
        }
      }
      
      return syncedCount;
    } catch (error) {
      logger.error('Error syncing all tickets:', error);
      throw error;
    }
  }

  async startPeriodicSync(interval) {
    logger.info(`Starting periodic sync with interval ${interval}ms`);
    
    const runSync = async () => {
      try {
        logger.info('Running periodic sync...');
        const activeTickets = await repository.getAllActiveTickets();
        
        for (const mapping of activeTickets) {
          try {
            await this.syncSingleTicket(mapping.whmcsTicketId);
          } catch (error) {
            // 如果是票務不存在的錯誤，syncSingleTicket 應該已經處理了清理
            // 這裡只記錄真正的錯誤
            if (error.message !== 'Ticket ID Not Found') {
              logger.error(`Error syncing ticket ${mapping.whmcsTicketId} in periodic sync:`, error);
            }
            // 繼續處理其他票務，不要停止整個同步
          }
        }
        
        logger.info('Periodic sync completed');
      } catch (error) {
        logger.error('Error in periodic sync:', error);
      }
    };
    
    await runSync();
    
    setInterval(runSync, interval);
  }
}

module.exports = new SyncService();