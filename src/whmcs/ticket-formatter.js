const { EmbedBuilder } = require('discord.js');

class TicketFormatter {
  static getPriorityColor(priority) {
    const colors = {
      'Low': 0x28a745,      // Green
      'Medium': 0xffc107,   // Yellow
      'High': 0xfd7e14,     // Orange
      'Urgent': 0xdc3545    // Red
    };
    return colors[priority] || 0x6c757d; // Default gray
  }

  static getStatusEmoji(status) {
    const emojis = {
      'Open': '🟢',
      'Answered': '💬',
      'Customer-Reply': '📨',
      'Closed': '🔒',
      'On Hold': '⏸️',
      'In Progress': '🔄'
    };
    return emojis[status] || '❓';
  }

  static createTicketEmbed(ticket, client = null) {
    const embed = new EmbedBuilder()
      .setTitle(`Ticket #${ticket.tid} - ${ticket.subject}`)
      .setColor(this.getPriorityColor(ticket.priority))
      .setTimestamp(new Date(ticket.date))
      .addFields(
        { name: 'Status', value: `${this.getStatusEmoji(ticket.status)} ${ticket.status}`, inline: true },
        { name: 'Priority', value: ticket.priority || 'Medium', inline: true },
        { name: 'Department', value: ticket.deptname || 'General', inline: true }
      );

    if (client) {
      embed.addFields(
        { name: 'Client', value: `${client.firstname} ${client.lastname}`, inline: true },
        { name: 'Email', value: client.email, inline: true },
        { name: 'Company', value: client.companyname || 'N/A', inline: true }
      );
    }

    if (ticket.lastreply) {
      embed.addFields({ name: 'Last Reply', value: new Date(ticket.lastreply).toLocaleString(), inline: false });
    }

    return embed;
  }

  static createReplyEmbed(reply, isAdmin = false) {
    const embed = new EmbedBuilder()
      .setColor(isAdmin ? 0x28a745 : 0x007bff)
      .setAuthor({ 
        name: reply.name || (isAdmin ? 'Staff' : 'Client'),
        iconURL: isAdmin ? 'https://cdn.discordapp.com/embed/avatars/0.png' : 'https://cdn.discordapp.com/embed/avatars/1.png'
      })
      .setDescription(reply.message)
      .setTimestamp(new Date(reply.date));

    if (reply.attachments && reply.attachments.length > 0) {
      const attachmentInfo = reply.attachments.map(a => {
        const filename = a.filename || a.name || 'Unknown file';
        const size = a.size ? ` (${this.formatFileSize(a.size)})` : '';
        return `📎 ${filename}${size}`;
      }).join('\n');
      
      embed.addFields({ 
        name: `Attachments (${reply.attachments.length})`, 
        value: attachmentInfo,
        inline: false 
      });
    }

    return embed;
  }

  static createStatusUpdateEmbed(ticketId, oldStatus, newStatus, updatedBy = 'System') {
    return new EmbedBuilder()
      .setColor(0xffc107)
      .setTitle('Ticket Status Updated')
      .setDescription(`Ticket #${ticketId} status changed`)
      .addFields(
        { name: 'From', value: `${this.getStatusEmoji(oldStatus)} ${oldStatus}`, inline: true },
        { name: 'To', value: `${this.getStatusEmoji(newStatus)} ${newStatus}`, inline: true },
        { name: 'Updated By', value: updatedBy, inline: true }
      )
      .setTimestamp();
  }

  static formatChannelName(priority, departmentName, ticketId) {
    const priorityPrefix = {
      'Low': '🟢',
      'Medium': '🟡',
      'High': '🟠',
      'Urgent': '🔴'
    };

    const prefix = priorityPrefix[priority] || '⚪';
    const cleanDeptName = departmentName.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 20);
    
    return `${prefix}-${cleanDeptName}-${ticketId}`;
  }

  static formatCategoryName(departmentName) {
    // 保留中文、英文、數字、空格和連字符
    // Discord 不允許的字符：@ # : ` ~ 
    const cleanName = departmentName
      .replace(/[@#:`~]/g, '') // 只移除 Discord 不允許的特殊字符
      .replace(/\s+/g, ' ') // 將多個空格合併為一個
      .trim()
      .substring(0, 100); // Discord category 名稱上限是 100 字符
    
    return cleanName || 'General Support';
  }

  static parseChannelName(channelName) {
    const match = channelName.match(/^[🟢🟡🟠🔴⚪]-(.+)-(\d+)$/);
    if (!match) return null;

    const priorityMap = {
      '🟢': 'Low',
      '🟡': 'Medium',
      '🟠': 'High',
      '🔴': 'Urgent',
      '⚪': 'Unknown'
    };

    return {
      priority: priorityMap[channelName[0]] || 'Unknown',
      department: match[1],
      ticketId: match[2]
    };
  }

  static formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

module.exports = TicketFormatter;