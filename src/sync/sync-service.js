const whmcsApi = require('../whmcs/api');
const discordBot = require('../bot/client');
const repository = require('../database/repository');
const TicketFormatter = require('../whmcs/ticket-formatter');
const logger = require('../utils/logger');
const attachmentHandler = require('../utils/attachment-handler');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const statusManager = require('../utils/status-manager');

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

const logInfo = (message) => {
  console.log(`${getTimestamp()} info: ${message}`);
  logger.info(message);
};

const logError = (message) => {
  console.error(`${getTimestamp()} error: ${message}`);
  logger.error(message);
};

const logWarn = (message) => {
  console.warn(`${getTimestamp()} warn: ${message}`);
  logger.warn(message);
};

class SyncService {
  async syncDepartments() {
    try {
      const departments = await whmcsApi.getSupportDepartments();
      
      for (const dept of departments) {
        const existingMapping = await repository.getDepartmentMappingByWhmcsId(dept.id);
        
        if (!existingMapping) {
          const categoryName = TicketFormatter.formatCategoryName(dept.name);
          
          let category = await discordBot.getCategoryByName(categoryName);
          
          if (category) {
            // 檢查這個 Discord 分類是否已被其他部門使用
            const existingCategoryMapping = await repository.getDepartmentMappingByCategoryId(category.id);
            
            if (existingCategoryMapping && existingCategoryMapping.whmcsDepartmentId !== dept.id) {
              // 如果分類已被其他部門使用，創建一個新的分類名稱
              const uniqueCategoryName = `${categoryName} - ${dept.id}`;
              category = await discordBot.getCategoryByName(uniqueCategoryName);
              if (!category) {
                category = await discordBot.createCategory(uniqueCategoryName);
              }
              logInfo(`⚠️ Category name conflict, created unique category: ${uniqueCategoryName}`);
              logger.info(`Category name conflict, created unique category: ${uniqueCategoryName}`);
            }
          } else {
            // 分類不存在，創建新的
            category = await discordBot.createCategory(categoryName);
          }
          
          try {
            await repository.createDepartmentMapping({
              whmcsDepartmentId: dept.id,
              departmentName: dept.name,
              discordCategoryId: category.id
            });
            
            logger.info(`Mapped department ${dept.name} to Discord category ${category.name}`);
          } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
              logError(`❌ Failed to map department ${dept.name}: Category ${category.id} already in use`);
              logger.error(`Unique constraint error for department ${dept.name}`, error);
            } else {
              throw error;
            }
          }
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
        
        // Only sync replies if the ticket still exists and wasn't recreated by updateExistingTicket
        const stillExists = await repository.getTicketMappingByWhmcsId(ticketId);
        if (stillExists) {
          const channel = await discordBot.getChannel(stillExists.discordChannelId);
          if (channel) {
            await this.syncTicketReplies(ticket);
          }
        }
      } else {
        await this.createNewTicketChannel(ticket);
        // createNewTicketChannel already calls syncTicketReplies, no need to call again
      }
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
      
      // 獲取部門權限映射
      const departmentRoleMappings = await repository.getDepartmentRoleMappingsByDepartmentId(ticket.deptid);
      const departmentRoles = departmentRoleMappings.map(mapping => mapping.discordRoleId);
      
      const channel = await discordBot.createTicketChannel(
        departmentMapping.discordCategoryId,
        channelName,
        `WHMCS Ticket #${ticket.tid} - ${ticket.subject}`,
        departmentRoles
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
      
      const ticketEmbed = await TicketFormatter.createTicketEmbed(ticket, client);
      
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

      // 注意：初始訊息內容通常在 replies 中，不需要單獨處理 ticket.message
      
      const ticketMapping = await repository.createTicketMapping({
        whmcsTicketId: ticket.tid,
        whmcsInternalId: ticket.internalId || ticket.id || ticket.ticketid,
        discordChannelId: channel.id,
        discordCategoryId: departmentMapping.discordCategoryId,
        departmentId: ticket.deptid,
        departmentName: ticket.deptname,
        priority: ticket.priority || 'Medium',
        status: ticket.status
      });
      
      logInfo(`📌 Created Discord channel for ticket ${ticket.tid}`);
      logger.info(`Created Discord channel for ticket ${ticket.tid}`);
      
      // 建立頻道和映射後立即同步回覆
      logger.info(`Starting reply sync for ticket ${ticket.tid}`);
      await this.syncTicketReplies(ticket);
      logger.info(`Completed reply sync for ticket ${ticket.tid}`);
    } catch (error) {
      logger.error('Error creating ticket channel with mapping:', error);
      throw error;
    }
  }

  async updateExistingTicket(ticket, mapping) {
    try {
      // First, always check if the channel exists
      const channel = await discordBot.getChannel(mapping.discordChannelId);
      
      if (!channel) {
        // Channel not found - recreate it if ticket is still active
        if (!statusManager.isClosedStatus(ticket.status)) {
          logger.warn(`Channel ${mapping.discordChannelId} not found for ticket ${ticket.tid}, recreating...`);
          logInfo(`⚠️ Channel missing for ticket ${ticket.tid}, recreating...`);
          
          // Recreate the channel
          await this.recreateTicketChannel(ticket, mapping);
          return; // Channel recreated, job done
        } else {
          // Ticket is closed and channel doesn't exist, clean up mapping
          logger.info(`Channel ${mapping.discordChannelId} not found for closed ticket ${ticket.tid}, cleaning up mapping`);
          await this.cleanupTicketData(ticket.tid);
          return;
        }
      }
      
      // Channel exists, now check for status changes
      if (mapping.status !== ticket.status) {
        const statusEmbed = await TicketFormatter.createStatusUpdateEmbed(
          ticket.tid,
          mapping.status,
          ticket.status
        );
        
        await channel.send({ embeds: [statusEmbed] });
        logger.info(`Status change detected for ticket ${ticket.tid}: ${mapping.status} → ${ticket.status}`);
        
        if (statusManager.isClosedStatus(ticket.status)) {
          // Delete channel and clean up database records
          await discordBot.deleteChannel(mapping.discordChannelId);
          await this.cleanupTicketData(ticket.tid);
          logger.info(`Deleted channel and cleaned up data for closed ticket ${ticket.tid}`);
          return; // Don't update mapping since we're deleting everything
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

  async recreateTicketChannel(ticket, mapping) {
    try {
      logger.info(`Recreating channel for ticket ${ticket.tid}`);
      logInfo(`🔧 Recreating channel for ticket ${ticket.tid}`);
      
      // Get department mapping to find the category
      const departmentMapping = await repository.getDepartmentMappingByWhmcsId(ticket.deptid);
      if (!departmentMapping) {
        throw new Error(`Department mapping not found for department ${ticket.deptid}`);
      }
      
      // Create new channel name with current ticket data
      const channelName = TicketFormatter.formatChannelName(
        ticket.priority || 'Medium',
        ticket.deptname,
        ticket.tid
      );
      
      // Get department role mappings
      const departmentRoleMappings = await repository.getDepartmentRoleMappingsByDepartmentId(ticket.deptid);
      const departmentRoles = departmentRoleMappings.map(mapping => mapping.discordRoleId);
      
      // Clean up old message sync records for this ticket since we're recreating the channel
      const oldMessageSyncs = await repository.getMessageSyncsByTicketId(ticket.tid);
      for (const messageSync of oldMessageSyncs) {
        await repository.deleteMessageSync(messageSync.id);
      }
      logger.info(`Cleaned up ${oldMessageSyncs.length} old message sync records for ticket ${ticket.tid}`);
      
      // Create new channel
      const newChannel = await discordBot.createTicketChannel(
        departmentMapping.discordCategoryId,
        channelName,
        `WHMCS Ticket #${ticket.tid} - ${ticket.subject}`,
        departmentRoles
      );
      
      // Update the mapping with new channel ID
      await repository.updateTicketMapping(ticket.tid, {
        discordChannelId: newChannel.id,
        status: ticket.status,
        priority: ticket.priority,
        lastSyncedAt: new Date()
      });
      
      // Get client details if available
      let client = null;
      if (ticket.userid && ticket.userid !== '' && ticket.userid !== '0') {
        try {
          client = await whmcsApi.getClient(ticket.userid);
        } catch (error) {
          logger.warn(`Failed to get client details for user ${ticket.userid}:`, error.message);
          client = null;
        }
      }
      
      // Create and send ticket embed
      const ticketEmbed = await TicketFormatter.createTicketEmbed(ticket, client);
      
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
      
      await newChannel.send({ 
        embeds: [ticketEmbed], 
        components: [actionRow] 
      });
      
      logger.info(`Successfully recreated channel for ticket ${ticket.tid} with ID ${newChannel.id}`);
      logInfo(`✅ Recreated channel for ticket ${ticket.tid}`);
      
      // Sync all replies to the new channel
      await this.syncTicketReplies(ticket);
      
    } catch (error) {
      logger.error(`Error recreating channel for ticket ${ticket.tid}:`, error);
      logError(`❌ Failed to recreate channel for ticket ${ticket.tid}: ${error.message}`);
      throw error;
    }
  }

  async syncTicketReplies(ticket) {
    try {
      logger.info(`syncTicketReplies called for ticket ${ticket.tid}`);
      
      const mapping = await repository.getTicketMappingByWhmcsId(ticket.tid);
      if (!mapping) {
        logger.warn(`No mapping found for ticket ${ticket.tid}`);
        return;
      }
      
      const channel = await discordBot.getChannel(mapping.discordChannelId);
      if (!channel) {
        logger.warn(`No channel found for ticket ${ticket.tid}, channel ID: ${mapping.discordChannelId}`);
        
        // Check if ticket is still active before recreating
        if (!statusManager.isClosedStatus(ticket.status)) {
          logger.info(`Ticket ${ticket.tid} is still active, recreating channel...`);
          logInfo(`⚠️ Channel missing for active ticket ${ticket.tid}, recreating...`);
          await this.recreateTicketChannel(ticket, mapping);
          return; // Channel recreated and replies synced
        } else {
          logger.info(`Ticket ${ticket.tid} is closed, cleaning up mapping`);
          await this.cleanupTicketData(ticket.tid);
          return;
        }
      }
      
      const replies = ticket.replies?.reply || [];
      logger.info(`Found ${replies.length} replies for ticket ${ticket.tid}`);
      
      // 檢查回覆結構但不跳過處理
      if (replies.length > 0 && typeof replies[0] === 'string') {
        logger.warn(`Ticket ${ticket.tid} has string replies instead of objects:`, replies);
        logWarn(`⚠️ Ticket ${ticket.tid} has unexpected reply format`);
        // 移除 return，繼續處理
      }
      
      for (const reply of replies) {
        // 記錄回覆結構以進行偵錯
        if (!reply.id && !reply.replyid) {
          logger.warn('Reply missing ID, skipping sync. Reply data:', JSON.stringify(reply));
          logWarn(`⚠️ Reply missing ID for ticket ${ticket.tid}`);
          continue;
        }
        
        // 嘗試使用 replyid 或 id
        const replyId = reply.replyid || reply.id;
        logger.info(`Processing reply for ticket ${ticket.tid}: replyId=${replyId}, admin=${reply.admin}, message preview="${reply.message ? reply.message.substring(0, 50) : 'EMPTY'}..."`);
        
        const existingSync = await repository.getMessageSyncByWhmcsReplyId(replyId, ticket.tid);
        logger.info(`Existing sync check for reply ${replyId}: ${existingSync ? `EXISTS (direction: ${existingSync.direction})` : 'NOT_EXISTS'}`);
        
        // 新的統一同步邏輯：
        // 1. 如果有 whmcs_to_discord 記錄 = 已同步過，跳過
        // 2. 如果只有 discord_to_whmcs 記錄 = 需要刪除舊記錄並同步embed格式
        // 3. 沒有記錄 = 正常同步
        let shouldSync = false;
        if (!existingSync) {
          shouldSync = true;
          logger.info(`Reply ${replyId} has no sync record, will sync to Discord`);
        } else if (existingSync.direction === 'whmcs_to_discord') {
          // 已經同步過了
          logger.info(`Reply ${replyId} already synced to Discord, skipping`);
          shouldSync = false;
        } else if (existingSync.direction === 'discord_to_whmcs') {
          // 這個回覆來自Discord，原訊息已被刪除，現在需要以embed格式同步
          logger.info(`Reply ${replyId} originated from Discord, will sync as embed format (original message deleted)`);
          shouldSync = true;
        }
        
        if (shouldSync) {
          const isAdmin = reply.admin !== '';
          const replyEmbed = TicketFormatter.createReplyEmbed(reply, isAdmin);
          
          let messageOptions = { embeds: [replyEmbed] };
          let processedAttachments = [];
          
          // 處理附件 - 使用新的 GetTicketAttachment API
          if (reply.attachments && reply.attachments.length > 0) {
            try {
              logInfo(`📎 Processing ${reply.attachments.length} attachments for reply ${replyId} using WHMCS API`);
              // 使用 internal ticket ID 而不是 external ticket ID
              const internalTicketId = ticket.id || ticket.ticketid;
              logger.info(`Using internal ticket ID for attachments: ${internalTicketId} (external: ${ticket.tid})`);
              
              processedAttachments = await attachmentHandler.processAttachments(
                reply.attachments, 
                whmcsApi, 
                internalTicketId,
                replyId
              );
              
              if (processedAttachments.length > 0) {
                messageOptions.files = processedAttachments.map(a => a.attachment);
                logInfo(`📎 Successfully processed ${processedAttachments.length} attachments`);
              } else {
                logInfo(`📎 No attachments could be processed - will show as links instead`);
              }
            } catch (error) {
              logger.error(`Error processing attachments for reply ${replyId}:`, error);
              logWarn(`⚠️ Failed to process attachments for reply ${replyId} - will show as links`);
            }
          }
          
          try {
            const message = await channel.send(messageOptions);
            
            // 如果這個回覆原本來自Discord，先刪除舊的記錄
            if (existingSync && existingSync.direction === 'discord_to_whmcs') {
              await repository.deleteMessageSync(existingSync.id);
              logger.info(`Deleted old discord_to_whmcs record for reply ${replyId}`);
            }
            
            // 創建新的同步記錄
            await repository.createMessageSync({
              whmcsTicketId: ticket.tid,
              whmcsReplyId: replyId,
              discordMessageId: message.id,
              direction: 'whmcs_to_discord'
            });
            
            if (existingSync && existingSync.direction === 'discord_to_whmcs') {
              logInfo(`📨 Re-synced Discord-originated reply ${replyId} as embed format for ticket ${ticket.tid}`);
              logger.info(`Re-synced Discord-originated reply ${replyId} as embed format`);
            } else {
              logInfo(`📨 Synced reply ${replyId} from WHMCS to Discord for ticket ${ticket.tid}`);
              logger.info(`Synced reply ${replyId} from WHMCS to Discord`);
            }
          } finally {
            // 清理臨時附件檔案
            if (processedAttachments.length > 0) {
              await attachmentHandler.cleanupAttachments(processedAttachments);
            }
          }
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
      
      const tickets = await whmcsApi.getAllTickets();
      let syncedCount = 0;
      
      logger.info(`Found ${tickets.length} tickets from WHMCS API`);
      
      for (const ticketSummary of tickets) {
        // 使用 tid (票務號碼) 而不是 id (內部數字 ID)
        const ticketId = ticketSummary.tid || ticketSummary.id;
        
        // 檢查是否已經有對應的映射
        const existingMapping = await repository.getTicketMappingByWhmcsId(ticketId);
        
        const activeStatusNames = await statusManager.getActiveStatusNames();
        if (activeStatusNames.includes(ticketSummary.status)) {
          
          if (!existingMapping) {
            // 先驗證票務是否真的存在，再創建頻道 (新票務或重新開啟的票務)
            logger.info(`Checking accessibility of ticket ${ticketId} (new or reopened)`);
            try {
              const ticketDetails = await whmcsApi.getTicket(ticketId);
              logger.info(`Ticket ${ticketId} is accessible, creating channel`);
              
              // 將列表中的內部 ID 添加到票務詳情中
              ticketDetails.internalId = ticketSummary.id || ticketSummary.ticketid;
              
              // 直接調用創建頻道的邏輯，syncTicketReplies 已在 createNewTicketChannel 中調用
              await this.createNewTicketChannel(ticketDetails);
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
            // 現有票務也需要同步可能遺漏的回覆和狀態更新
            logger.debug(`Ticket ${ticketId} already has mapping, checking for updates`);
            try {
              const ticketDetails = await whmcsApi.getTicket(ticketId);
              ticketDetails.internalId = ticketSummary.id || ticketSummary.ticketid;
              
              // 檢查狀態和頻道是否需要更新，updateExistingTicket 會處理頻道重建
              await this.updateExistingTicket(ticketDetails, existingMapping);
              
              // 如果票務未被刪除，同步回覆（updateExistingTicket 已確保頻道存在或已重建）
              const stillExists = await repository.getTicketMappingByWhmcsId(ticketId);
              if (stillExists) {
                await this.syncTicketReplies(ticketDetails);
              }
            } catch (error) {
              logger.error(`Error syncing existing ticket ${ticketId}:`, error);
            }
          }
        } else if (statusManager.isClosedStatus(ticketSummary.status) && existingMapping) {
          // 處理已關閉的票務，刪除對應的頻道和資料
          logger.info(`Ticket ${ticketId} is closed, cleaning up Discord channel and data`);
          try {
            await discordBot.deleteChannel(existingMapping.discordChannelId);
            await this.cleanupTicketData(ticketId);
            logInfo(`🗑️ Deleted channel and cleaned up data for closed ticket ${ticketId}`);
          } catch (error) {
            logger.error(`Error cleaning up closed ticket ${ticketId}:`, error);
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
        logInfo(`🔄 Running periodic sync...`);
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
        
        logInfo(`✅ Periodic sync completed - checked ${activeTickets.length} active tickets`);
        logger.info('Periodic sync completed');
        
        // 清理臨時附件檔案
        try {
          await attachmentHandler.cleanupTempDir();
        } catch (error) {
          logger.warn('Error during temp file cleanup:', error);
        }
      } catch (error) {
        logError(`❌ Error in periodic sync: ${error.message}`);
        logger.error('Error in periodic sync:', error);
      }
    };
    
    await runSync();
    
    setInterval(runSync, interval);
  }

  async cleanupTicketData(ticketId) {
    try {
      // Delete all message sync records for this ticket
      const messageSyncs = await repository.getMessageSyncsByTicketId(ticketId);
      for (const messageSync of messageSyncs) {
        await repository.deleteMessageSync(messageSync.id);
      }
      
      // Delete the ticket mapping
      await repository.deleteTicketMapping(ticketId);
      
      logger.info(`Cleaned up all data for ticket ${ticketId}`);
    } catch (error) {
      logger.error(`Error cleaning up ticket data for ${ticketId}:`, error);
      throw error;
    }
  }
}

module.exports = new SyncService();