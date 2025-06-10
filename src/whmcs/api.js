const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config');
const logger = require('../utils/logger');

class WhmcsApi {
  constructor() {
    this.apiUrl = config.whmcs.apiUrl;
    this.identifier = config.whmcs.apiIdentifier;
    this.secret = config.whmcs.apiSecret;
  }

  generateRequestString(params) {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {});

    return Object.entries(sortedParams)
      .map(([key, value]) => `${key}=${value}`)
      .join('');
  }

  async makeRequest(action, params = {}) {
    try {
      const requestParams = {
        ...params,
        action,
        username: this.identifier,
        password: this.secret,
        responsetype: 'json'
      };

      const response = await axios.post(this.apiUrl, new URLSearchParams(requestParams), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (response.data.result === 'error') {
        throw new Error(response.data.message || 'WHMCS API error');
      }

      return response.data;
    } catch (error) {
      logger.error(`WHMCS API error for action ${action}:`, error);
      throw error;
    }
  }

  async getSupportDepartments() {
    try {
      const response = await this.makeRequest('GetSupportDepartments');
      return response.departments.department || [];
    } catch (error) {
      logger.error('Error fetching support departments:', error);
      throw error;
    }
  }

  async getTicket(ticketId) {
    try {
      const response = await this.makeRequest('GetTicket', { ticketnum: ticketId });
      return response;
    } catch (error) {
      logger.error(`Error fetching ticket ${ticketId}:`, error);
      throw error;
    }
  }

  async getTickets(status = '', departmentId = '') {
    try {
      const params = {};
      if (status) params.status = status;
      if (departmentId) params.deptid = departmentId;
      
      const response = await this.makeRequest('GetTickets', params);
      return response.tickets.ticket || [];
    } catch (error) {
      logger.error('Error fetching tickets:', error);
      throw error;
    }
  }

  async addTicketReply(ticketId, message, clientId = '', adminUsername = '', attachments = []) {
    try {
      const params = {
        ticketid: ticketId,
        message: message
      };

      if (clientId) {
        params.clientid = clientId;
        params.contactid = '';
      } else if (adminUsername) {
        params.adminusername = adminUsername;
      }

      // 處理附件
      if (attachments && attachments.length > 0) {
        // WHMCS 需要的格式：base64_encode(json_encode([['name' => 'filename', 'data' => base64_encoded_content]]))
        const attachmentData = attachments.map(attachment => ({
          name: attachment.name,
          data: attachment.data // 已經是 base64 編碼的內容
        }));
        
        params.attachments = Buffer.from(JSON.stringify(attachmentData)).toString('base64');
        logger.info(`Adding ${attachments.length} attachments to ticket reply`);
      }

      const response = await this.makeRequest('AddTicketReply', params);
      return response;
    } catch (error) {
      logger.error(`Error adding reply to ticket ${ticketId}:`, error);
      throw error;
    }
  }

  async updateTicket(ticketId, updates) {
    try {
      const params = { ticketid: ticketId, ...updates };
      const response = await this.makeRequest('UpdateTicket', params);
      return response;
    } catch (error) {
      logger.error(`Error updating ticket ${ticketId}:`, error);
      throw error;
    }
  }

  async getAdminUsers() {
    try {
      const response = await this.makeRequest('GetAdminUsers');
      return response.admin_users || [];
    } catch (error) {
      logger.error('Error fetching admin users:', error);
      throw error;
    }
  }

  async openTicket(departmentId, subject, message, priority, clientId = '', contactId = '') {
    try {
      const params = {
        deptid: departmentId,
        subject: subject,
        message: message,
        priority: priority
      };

      if (clientId) {
        params.clientid = clientId;
        if (contactId) params.contactid = contactId;
      }

      const response = await this.makeRequest('OpenTicket', params);
      return response;
    } catch (error) {
      logger.error('Error opening ticket:', error);
      throw error;
    }
  }

  async getClient(clientId) {
    try {
      const response = await this.makeRequest('GetClientsDetails', { clientid: clientId });
      return response.client;
    } catch (error) {
      logger.error(`Error fetching client ${clientId}:`, error);
      throw error;
    }
  }

  validateWebhook(data, signature) {
    try {
      const payload = JSON.stringify(data);
      const expectedSignature = crypto
        .createHmac('sha256', config.webhook.secret)
        .update(payload)
        .digest('hex');
      
      return signature === expectedSignature;
    } catch (error) {
      logger.error('Error validating webhook signature:', error);
      return false;
    }
  }
}

module.exports = new WhmcsApi();