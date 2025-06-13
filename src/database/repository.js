const { TicketMapping, DepartmentMapping, DepartmentRoleMapping, MessageSync } = require('./models');
const logger = require('../utils/logger');

class Repository {
  async createTicketMapping(data) {
    try {
      return await TicketMapping.create(data);
    } catch (error) {
      logger.error('Error creating ticket mapping:', error);
      throw error;
    }
  }

  async getTicketMappingByWhmcsId(whmcsTicketId) {
    try {
      return await TicketMapping.findOne({
        where: { whmcsTicketId }
      });
    } catch (error) {
      logger.error('Error getting ticket mapping by WHMCS ID:', error);
      throw error;
    }
  }

  async getTicketMappingByChannelId(discordChannelId) {
    try {
      return await TicketMapping.findOne({
        where: { discordChannelId }
      });
    } catch (error) {
      logger.error('Error getting ticket mapping by channel ID:', error);
      throw error;
    }
  }

  async updateTicketMapping(whmcsTicketId, updates) {
    try {
      const [updatedCount] = await TicketMapping.update(updates, {
        where: { whmcsTicketId }
      });
      return updatedCount > 0;
    } catch (error) {
      logger.error('Error updating ticket mapping:', error);
      throw error;
    }
  }

  async createDepartmentMapping(data) {
    try {
      return await DepartmentMapping.create(data);
    } catch (error) {
      logger.error('Error creating department mapping:', error);
      throw error;
    }
  }

  async getDepartmentMappingByWhmcsId(whmcsDepartmentId) {
    try {
      return await DepartmentMapping.findOne({
        where: { whmcsDepartmentId }
      });
    } catch (error) {
      logger.error('Error getting department mapping:', error);
      throw error;
    }
  }

  async getDepartmentMappingByCategoryId(discordCategoryId) {
    try {
      return await DepartmentMapping.findOne({
        where: { discordCategoryId }
      });
    } catch (error) {
      logger.error('Error getting department mapping by category:', error);
      throw error;
    }
  }

  async getAllDepartmentMappings() {
    try {
      return await DepartmentMapping.findAll();
    } catch (error) {
      logger.error('Error getting all department mappings:', error);
      throw error;
    }
  }

  async createMessageSync(data) {
    try {
      return await MessageSync.create(data);
    } catch (error) {
      logger.error('Error creating message sync:', error);
      throw error;
    }
  }

  async getMessageSyncByDiscordId(discordMessageId) {
    try {
      return await MessageSync.findOne({
        where: { discordMessageId }
      });
    } catch (error) {
      logger.error('Error getting message sync:', error);
      throw error;
    }
  }

  async getMessageSyncByWhmcsReplyId(whmcsReplyId, whmcsTicketId = null) {
    try {
      const whereCondition = { whmcsReplyId };
      if (whmcsTicketId) {
        whereCondition.whmcsTicketId = whmcsTicketId;
      }
      
      return await MessageSync.findOne({
        where: whereCondition
      });
    } catch (error) {
      logger.error('Error getting message sync by WHMCS reply ID:', error);
      throw error;
    }
  }

  async deleteMessageSync(id) {
    try {
      const deletedCount = await MessageSync.destroy({
        where: { id }
      });
      return deletedCount > 0;
    } catch (error) {
      logger.error('Error deleting message sync:', error);
      throw error;
    }
  }

  async deleteTicketMapping(whmcsTicketId) {
    try {
      const deletedCount = await TicketMapping.destroy({
        where: { whmcsTicketId }
      });
      return deletedCount > 0;
    } catch (error) {
      logger.error('Error deleting ticket mapping:', error);
      throw error;
    }
  }

  async getAllActiveTickets() {
    try {
      return await TicketMapping.findAll({
        where: {
          status: ['Open', 'Answered', 'Customer-Reply']
        }
      });
    } catch (error) {
      logger.error('Error getting active tickets:', error);
      throw error;
    }
  }

  async getMessageSyncsByTicketId(whmcsTicketId) {
    try {
      return await MessageSync.findAll({
        where: { whmcsTicketId }
      });
    } catch (error) {
      logger.error('Error getting message syncs by ticket ID:', error);
      throw error;
    }
  }

  async createDepartmentRoleMapping(data) {
    try {
      return await DepartmentRoleMapping.create(data);
    } catch (error) {
      logger.error('Error creating department role mapping:', error);
      throw error;
    }
  }

  async getDepartmentRoleMappingsByDepartmentId(whmcsDepartmentId) {
    try {
      return await DepartmentRoleMapping.findAll({
        where: { whmcsDepartmentId }
      });
    } catch (error) {
      logger.error('Error getting department role mappings:', error);
      throw error;
    }
  }

  async getDepartmentRoleMapping(whmcsDepartmentId, discordRoleId) {
    try {
      return await DepartmentRoleMapping.findOne({
        where: { 
          whmcsDepartmentId,
          discordRoleId 
        }
      });
    } catch (error) {
      logger.error('Error getting specific department role mapping:', error);
      throw error;
    }
  }

  async deleteDepartmentRoleMapping(whmcsDepartmentId, discordRoleId) {
    try {
      const deletedCount = await DepartmentRoleMapping.destroy({
        where: { 
          whmcsDepartmentId,
          discordRoleId 
        }
      });
      return deletedCount > 0;
    } catch (error) {
      logger.error('Error deleting department role mapping:', error);
      throw error;
    }
  }

  async getAllDepartmentRoleMappings() {
    try {
      return await DepartmentRoleMapping.findAll();
    } catch (error) {
      logger.error('Error getting all department role mappings:', error);
      throw error;
    }
  }
}

module.exports = new Repository();