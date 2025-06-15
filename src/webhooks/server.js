const express = require('express');
const bodyParser = require('body-parser');
const config = require('../../config');
const logger = require('../utils/logger');
const webhookHandler = require('./webhook-handler');

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

class WebhookServer {
  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(bodyParser.json());
    this.app.use(bodyParser.urlencoded({ extended: true }));
    
    this.app.use((req, res, next) => {
      logInfo(`🔔 Webhook received: ${req.method} ${req.path}`);
      logger.info(`Webhook received: ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    this.app.post('/webhook/ticket', async (req, res) => {
      try {
        const signature = req.headers['x-whmcs-signature'];
        const isValid = webhookHandler.validateSignature(req.body, signature);
        
        if (!isValid) {
          logger.warn('Invalid webhook signature');
          return res.status(401).json({ error: 'Invalid signature' });
        }
        
        await webhookHandler.handleTicketWebhook(req.body);
        res.status(200).json({ success: true });
      } catch (error) {
        logger.error('Error handling ticket webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    this.app.post('/webhook/reply', async (req, res) => {
      try {
        const signature = req.headers['x-whmcs-signature'];
        const isValid = webhookHandler.validateSignature(req.body, signature);
        
        if (!isValid) {
          logger.warn('Invalid webhook signature');
          return res.status(401).json({ error: 'Invalid signature' });
        }
        
        await webhookHandler.handleReplyWebhook(req.body);
        res.status(200).json({ success: true });
      } catch (error) {
        logger.error('Error handling reply webhook:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    
    this.app.get('/health', (req, res) => {
      res.status(200).json({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
      });
    });
    
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  start() {
    const port = config.webhook.port;
    
    this.server = this.app.listen(port, () => {
      logger.info(`Webhook server listening on port ${port}`);
    });
    
    this.server.on('error', (error) => {
      logger.error('Webhook server error:', error);
    });
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        logger.info('Webhook server stopped');
      });
    }
  }
}

module.exports = new WebhookServer();