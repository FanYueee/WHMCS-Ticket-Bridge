const { AttachmentBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

class AttachmentHandler {
  constructor() {
    this.tempDir = path.join(__dirname, '../../temp');
    this.maxFileSize = 25 * 1024 * 1024; // Discord 25MB limit
    this.allowedExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.txt', '.rtf', '.csv', '.zip', '.rar', '.7z',
      '.mp3', '.mp4', '.avi', '.mov', '.wmv'
    ];
  }

  async ensureTempDir() {
    try {
      await fs.access(this.tempDir);
    } catch {
      await fs.mkdir(this.tempDir, { recursive: true });
    }
  }

  isAllowedFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return this.allowedExtensions.includes(ext);
  }

  isFileSizeAllowed(size) {
    return size <= this.maxFileSize;
  }

  generateTempFilename(originalName) {
    const ext = path.extname(originalName);
    const hash = crypto.randomBytes(16).toString('hex');
    return `${hash}${ext}`;
  }

  async saveAttachmentToTemp(data, filename) {
    await this.ensureTempDir();
    
    const tempFilename = this.generateTempFilename(filename);
    const tempPath = path.join(this.tempDir, tempFilename);
    
    await fs.writeFile(tempPath, data);
    return tempPath;
  }

  async createDiscordAttachment(data, filename) {
    try {
      if (!this.isAllowedFile(filename)) {
        logger.warn(`File ${filename} has unsupported extension, skipping`);
        return null;
      }

      if (!this.isFileSizeAllowed(data.length)) {
        logger.warn(`File ${filename} is too large (${data.length} bytes), skipping`);
        return null;
      }

      const tempPath = await this.saveAttachmentToTemp(data, filename);
      
      const attachment = new AttachmentBuilder(tempPath, { 
        name: filename,
        description: `Attachment from WHMCS ticket`
      });

      return {
        attachment,
        tempPath,
        cleanup: async () => {
          try {
            await fs.unlink(tempPath);
          } catch (error) {
            logger.warn(`Failed to cleanup temp file ${tempPath}:`, error);
          }
        }
      };
    } catch (error) {
      logger.error(`Error creating Discord attachment for ${filename}:`, error);
      return null;
    }
  }

  async processAttachments(attachments, whmcsApi, ticketId, replyId = null) {
    const processedAttachments = [];
    
    for (const attachment of attachments) {
      try {
        logger.info(`Processing attachment: ${attachment.filename || attachment.name}`);
        
        let attachmentData;
        let filename;

        if (attachment.filename && typeof attachment.index !== 'undefined') {
          // WHMCS attachment format with filename and index
          try {
            const downloadResult = await whmcsApi.downloadAttachment(attachment.index, ticketId, replyId);
            attachmentData = downloadResult.data;
            filename = attachment.filename;
            logger.info(`Successfully downloaded attachment: ${filename}`);
          } catch (downloadError) {
            logger.error(`Failed to download attachment ${attachment.filename}:`, downloadError);
            continue;
          }
        } else if (attachment.id && attachment.filename) {
          // WHMCS attachment format with ID
          const downloadResult = await whmcsApi.downloadAttachment(attachment.id, ticketId, replyId);
          attachmentData = downloadResult.data;
          filename = attachment.filename;
        } else if (attachment.data && attachment.name) {
          // Direct data format
          attachmentData = Buffer.from(attachment.data, 'base64');
          filename = attachment.name;
        } else {
          logger.warn('Unknown attachment format, skipping:', {
            hasFilename: !!attachment.filename,
            hasIndex: typeof attachment.index !== 'undefined',
            hasId: !!attachment.id,
            hasData: !!attachment.data,
            hasName: !!attachment.name,
            attachment
          });
          continue;
        }


        const discordAttachment = await this.createDiscordAttachment(attachmentData, filename);
        
        if (discordAttachment) {
          processedAttachments.push(discordAttachment);
        }
      } catch (error) {
        logger.error(`Failed to process attachment ${attachment.filename || attachment.name}:`, error);
        // Continue processing other attachments
      }
    }

    return processedAttachments;
  }

  async cleanupAttachments(processedAttachments) {
    for (const attachment of processedAttachments) {
      if (attachment.cleanup) {
        await attachment.cleanup();
      }
    }
  }

  async cleanupTempDir() {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = await fs.stat(filePath);
        
        // Delete files older than 1 hour
        if (now - stats.mtime.getTime() > 60 * 60 * 1000) {
          await fs.unlink(filePath);
          logger.debug(`Cleaned up old temp file: ${file}`);
        }
      }
    } catch (error) {
      logger.warn('Error cleaning up temp directory:', error);
    }
  }
}

module.exports = new AttachmentHandler();