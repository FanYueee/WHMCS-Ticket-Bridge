const config = require('../../config');
const whmcsApi = require('../whmcs/api');
const logger = require('./logger');

class StatusManager {
  constructor() {
    this.statusCache = null;
    this.cacheExpiry = null;
    this.emojiCache = new Map();
  }

  // 獲取所有狀態（核心 + 自訂）
  async getAllStatuses() {
    try {
      // 檢查快取
      if (this.statusCache && this.cacheExpiry > Date.now()) {
        return this.statusCache;
      }

      // 從 WHMCS 獲取所有狀態
      const statuses = await whmcsApi.getSupportStatuses();
      
      // 快取 10 分鐘
      this.statusCache = statuses;
      this.cacheExpiry = Date.now() + 10 * 60 * 1000;
      
      logger.info(`Loaded ${statuses.length} support statuses from WHMCS`);
      return statuses;
    } catch (error) {
      logger.error('Error getting all statuses:', error);
      // 返回基本狀態作為備案
      return this.getBasicStatuses();
    }
  }

  // 取得基本狀態（備案）
  getBasicStatuses() {
    return [
      { title: config.statusMapping.open, color: '#28a745' },
      { title: config.statusMapping.answered, color: '#007bff' },
      { title: config.statusMapping.customerReply, color: '#fd7e14' },
      { title: config.statusMapping.closed, color: '#6c757d' }
    ];
  }

  // 檢查是否為關閉狀態
  isClosedStatus(status) {
    return status === config.statusMapping.closed;
  }

  // 檢查是否為開啟狀態
  isOpenStatus(status) {
    return status === config.statusMapping.open;
  }

  // 檢查是否為已回覆狀態
  isAnsweredStatus(status) {
    return status === config.statusMapping.answered;
  }

  // 檢查是否為客戶回覆狀態
  isCustomerReplyStatus(status) {
    return status === config.statusMapping.customerReply;
  }

  // 檢查是否為活躍狀態（用於同步）
  isActiveStatus(status) {
    return !this.isClosedStatus(status);
  }

  // 獲取狀態的 emoji
  async getStatusEmoji(status) {
    // 先檢查快取
    if (this.emojiCache.has(status)) {
      return this.emojiCache.get(status);
    }

    // 核心狀態的固定 emoji
    const coreEmojis = {
      [config.statusMapping.open]: '🟢',
      [config.statusMapping.answered]: '💬',
      [config.statusMapping.customerReply]: '📨',
      [config.statusMapping.closed]: '🔒'
    };

    if (coreEmojis[status]) {
      this.emojiCache.set(status, coreEmojis[status]);
      return coreEmojis[status];
    }

    // 自訂狀態的動態 emoji
    const customEmojis = {
      'On Hold': '⏸️',
      'In Progress': '🔄',
      'Pending': '⏳',
      'Escalated': '🔺',
      'Resolved': '✅',
      'Cancelled': '❌'
    };

    const emoji = customEmojis[status] || '❓';
    this.emojiCache.set(status, emoji);
    return emoji;
  }

  // 獲取所有活躍狀態名稱（用於資料庫查詢）
  async getActiveStatusNames() {
    try {
      const allStatuses = await this.getAllStatuses();
      return allStatuses
        .map(s => s.title)
        .filter(status => this.isActiveStatus(status));
    } catch (error) {
      logger.error('Error getting active status names:', error);
      // 返回基本的活躍狀態
      return [
        config.statusMapping.open,
        config.statusMapping.answered,
        config.statusMapping.customerReply
      ];
    }
  }

  // 清除快取
  clearCache() {
    this.statusCache = null;
    this.cacheExpiry = null;
    this.emojiCache.clear();
    logger.info('Status cache cleared');
  }
}

module.exports = new StatusManager();