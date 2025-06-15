const { Sequelize, DataTypes } = require('sequelize');
const config = require('../../../config');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(config.database.path),
  logging: false
});

const TicketMapping = sequelize.define('TicketMapping', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  whmcsTicketId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  whmcsInternalId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  discordChannelId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  discordCategoryId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  departmentId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  departmentName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  priority: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false
  },
  lastSyncedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ticket_mappings',
  timestamps: true
});

const DepartmentMapping = sequelize.define('DepartmentMapping', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  whmcsDepartmentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true
  },
  departmentName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  discordCategoryId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
}, {
  tableName: 'department_mappings',
  timestamps: true
});

const MessageSync = sequelize.define('MessageSync', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  whmcsTicketId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  whmcsReplyId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  discordMessageId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  direction: {
    type: DataTypes.ENUM('whmcs_to_discord', 'discord_to_whmcs'),
    allowNull: false
  },
  syncedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'message_syncs',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['whmcsTicketId', 'whmcsReplyId']
    }
  ]
});

const DepartmentRoleMapping = sequelize.define('DepartmentRoleMapping', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  whmcsDepartmentId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  departmentName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  discordRoleId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  discordRoleName: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  tableName: 'department_role_mappings',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['whmcsDepartmentId', 'discordRoleId']
    }
  ]
});

module.exports = {
  sequelize,
  TicketMapping,
  DepartmentMapping,
  DepartmentRoleMapping,
  MessageSync
};