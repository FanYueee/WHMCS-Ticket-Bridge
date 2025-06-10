const { sequelize } = require('../src/database/models');
const logger = require('../src/utils/logger');

async function migrate() {
  try {
    logger.info('Starting database migration...');
    
    await sequelize.authenticate();
    logger.info('Database connection established successfully.');
    
    await sequelize.sync({ force: false });
    logger.info('Database tables created successfully.');
    
    process.exit(0);
  } catch (error) {
    logger.error('Database migration failed:', error);
    process.exit(1);
  }
}

migrate();