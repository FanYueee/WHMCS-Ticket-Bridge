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

  async getTickets(status = '', departmentId = '', limitStart = 0, limitNum = 100) {
    try {
      const params = {
        limitstart: limitStart,
        limitnum: limitNum
      };
      if (status) params.status = status;
      if (departmentId) params.deptid = departmentId;
      
      const response = await this.makeRequest('GetTickets', params);
      return response.tickets.ticket || [];
    } catch (error) {
      logger.error('Error fetching tickets:', error);
      throw error;
    }
  }

  async getAllTickets(status = '', departmentId = '') {
    try {
      let allTickets = [];
      let limitStart = 0;
      const limitNum = 100;
      let hasMoreTickets = true;

      while (hasMoreTickets) {
        const tickets = await this.getTickets(status, departmentId, limitStart, limitNum);
        
        if (tickets.length === 0) {
          hasMoreTickets = false;
        } else {
          allTickets = allTickets.concat(tickets);
          limitStart += limitNum;
          
          // 如果返回的票務數量少於請求數量，表示沒有更多票務了
          if (tickets.length < limitNum) {
            hasMoreTickets = false;
          }
        }
      }

      return allTickets;
    } catch (error) {
      logger.error('Error fetching all tickets:', error);
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

  async getSupportStatuses(departmentId = '') {
    try {
      const params = {};
      if (departmentId) params.deptid = departmentId;
      
      const response = await this.makeRequest('GetSupportStatuses', params);
      return response.statuses?.status || [];  // 正確的路徑：statuses.status
    } catch (error) {
      logger.error('Error fetching support statuses:', error);
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

  async downloadAttachment(attachmentIdentifier, ticketId, replyId = null, retries = 2) {
    logger.info(`downloadAttachment called with: attachmentId=${attachmentIdentifier}, ticketId=${ticketId}, replyId=${replyId}`);
    
    const downloadMethods = [];
    
    // 方法1: 使用 ticket 類型 (最可靠的官方方法)
    if (ticketId && ticketId !== null && ticketId !== 'null' && ticketId !== '') {
      downloadMethods.push({
        name: 'WHMCS GetTicketAttachment API (ticket)',
        data: {
          action: 'GetTicketAttachment',
          relatedid: String(ticketId),
          type: 'ticket',
          index: String(attachmentIdentifier),
          username: this.identifier,
          password: this.secret,
          responsetype: 'json'
        }
      });
    }
    
    if (replyId && replyId !== null && replyId !== 'null' && replyId !== '') {
      downloadMethods.push({
        name: 'WHMCS GetTicketAttachment API (reply)',
        data: {
          action: 'GetTicketAttachment',
          relatedid: String(replyId),
          type: 'reply',
          index: String(attachmentIdentifier),
          username: this.identifier,
          password: this.secret,
          responsetype: 'json'
        }
      });
    }
    
    if (downloadMethods.length === 0) {
      throw new Error(`No valid download methods available - missing required IDs: ticketId=${ticketId}, replyId=${replyId}`);
    }
    
    logger.info(`Using ${downloadMethods.length} official WHMCS API methods for attachment ${attachmentIdentifier}`);
    
    for (const method of downloadMethods) {
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        try {
          logger.info(`Trying ${method.name} (attempt ${attempt}/${retries + 1}) with params:`, JSON.stringify(method.data));
          
          const response = await axios.post(this.apiUrl, new URLSearchParams(method.data), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000
          });
          
          logger.info(`API Response: ${method.name} - result: ${response.data.result}, message: ${response.data.message || 'none'}`);
          
          if (response.data.result === 'success' && response.data.data) {
            const attachmentData = Buffer.from(response.data.data, 'base64');
            const filename = response.data.filename || 'attachment';
            
            if (attachmentData.length > 0) {
              const isPng = attachmentData[0] === 0x89 && attachmentData[1] === 0x50;
              const isJpeg = attachmentData[0] === 0xFF && attachmentData[1] === 0xD8;
              
              logger.info(`Successfully downloaded attachment via ${method.name}: ${filename} (${attachmentData.length} bytes, ${isPng ? 'PNG' : isJpeg ? 'JPEG' : 'unknown format'})`);
              
              return {
                data: attachmentData,
                contentType: isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'application/octet-stream',
                contentLength: attachmentData.length
              };
            } else {
              logger.warn(`${method.name} returned empty data`);
              continue;
            }
          } else {
            logger.warn(`${method.name} failed: ${response.data.message || 'Unknown error'}`);
            continue;
          }
        } catch (error) {
          const isLastAttempt = attempt === retries + 1;
          
          if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            logger.warn(`${method.name} timeout on attempt ${attempt}/${retries + 1}`);
            if (!isLastAttempt) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
              continue;
            }
          }
          
          if (isLastAttempt) {
            logger.warn(`${method.name} failed after all attempts: ${error.message}`);
            break; 
          } else {
            logger.warn(`${method.name} attempt ${attempt} failed, retrying: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }
    }
    
    // 所有方法都失敗
    const error = new Error(`All download methods failed for attachment ${attachmentIdentifier}`);
    logger.error(`Error downloading attachment ${attachmentIdentifier} for ticket ${ticketId}:`, {
      message: error.message,
      ticketId,
      attachmentIdentifier,
      replyId
    });
    throw error;
  }

  async getTicketAttachments(ticketId) {
    try {
      const response = await this.makeRequest('GetTicketAttachments', { ticketid: ticketId });
      return response.attachments || [];
    } catch (error) {
      if (error.message.includes('No attachments found')) {
        return [];
      }
      logger.error(`Error fetching attachments for ticket ${ticketId}:`, error);
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