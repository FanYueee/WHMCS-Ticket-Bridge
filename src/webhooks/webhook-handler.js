const crypto = require('crypto');
const config = require('../../config');
const syncService = require('../sync/sync-service');
const repository = require('../database/repository');
const logger = require('../utils/logger');

class WebhookHandler {
  validateSignature(payload, signature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', config.webhook.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      return signature === expectedSignature;
    } catch (error) {
      logger.error('Error validating webhook signature:', error);
      return false;
    }
  }

  async handleTicketWebhook(data) {
    try {
      const { action, ticket_id, status, priority } = data;
      
      logger.info(`Received ticket webhook: ${action} for ticket ${ticket_id}`);
      
      switch (action) {
        case 'opened':
          await this.handleTicketOpened(ticket_id);
          break;
        
        case 'updated':
          await this.handleTicketUpdated(ticket_id, { status, priority });
          break;
        
        case 'closed':
          await this.handleTicketClosed(ticket_id);
          break;
        
        case 'deleted':
          await this.handleTicketDeleted(ticket_id);
          break;
        
        default:
          logger.warn(`Unhandled ticket action: ${action}`);
      }
    } catch (error) {
      logger.error('Error handling ticket webhook:', error);
      throw error;
    }
  }

  async handleReplyWebhook(data) {
    try {
      const { ticket_id, reply_id, admin } = data;
      
      logger.info(`Received reply webhook for ticket ${ticket_id}, reply ${reply_id}`);
      
      const existingSync = await repository.getMessageSyncByWhmcsReplyId(reply_id);
      
      if (!existingSync) {
        await syncService.syncSingleTicket(ticket_id);
      }
    } catch (error) {
      logger.error('Error handling reply webhook:', error);
      throw error;
    }
  }

  async handleTicketOpened(ticketId) {
    try {
      logger.info(`Handling new ticket: ${ticketId}`);
      await syncService.syncSingleTicket(ticketId);
    } catch (error) {
      logger.error(`Error handling ticket opened: ${ticketId}`, error);
      throw error;
    }
  }

  async handleTicketUpdated(ticketId, updates) {
    try {
      logger.info(`Handling ticket update: ${ticketId}`, updates);
      
      const mapping = await repository.getTicketMappingByWhmcsId(ticketId);
      
      if (mapping) {
        await syncService.syncSingleTicket(ticketId);
      }
    } catch (error) {
      logger.error(`Error handling ticket update: ${ticketId}`, error);
      throw error;
    }
  }

  async handleTicketClosed(ticketId) {
    try {
      logger.info(`Handling ticket closed: ${ticketId}`);
      
      const mapping = await repository.getTicketMappingByWhmcsId(ticketId);
      
      if (mapping) {
        const discordBot = require('../bot/client');
        const syncService = require('../sync/sync-service');
        
        // Delete channel and clean up database records
        await discordBot.deleteChannel(mapping.discordChannelId);
        await syncService.cleanupTicketData(ticketId);
        
        logger.info(`Deleted channel and cleaned up data for closed ticket ${ticketId}`);
      }
    } catch (error) {
      logger.error(`Error handling ticket closed: ${ticketId}`, error);
      throw error;
    }
  }

  async handleTicketDeleted(ticketId) {
    try {
      logger.info(`Handling ticket deleted: ${ticketId}`);
      
      const mapping = await repository.getTicketMappingByWhmcsId(ticketId);
      
      if (mapping) {
        const discordBot = require('../bot/client');
        const syncService = require('../sync/sync-service');
        const channel = await discordBot.getChannel(mapping.discordChannelId);
        
        if (channel) {
          await channel.delete('WHMCS ticket deleted');
        } else {
          logger.warn(`Channel ${mapping.discordChannelId} not found for deleted ticket ${ticketId}`);
        }
        
        // Clean up mapping regardless of whether channel existed
        await syncService.cleanupTicketData(ticketId);
        logger.info(`Cleaned up data for deleted ticket ${ticketId}`);
      }
    } catch (error) {
      logger.error(`Error handling ticket deleted: ${ticketId}`, error);
      throw error;
    }
  }
}

module.exports = new WebhookHandler();