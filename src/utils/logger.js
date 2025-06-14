const winston = require('winston');
const path = require('path');
const config = require('../../config');

const logDir = path.join(__dirname, '../../logs');

function generateTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}-${hour}-${minute}-${second}`;
}

const timestamp = generateTimestamp();
const combinedLogFile = path.join(logDir, `combined-${timestamp}.log`);

let errorTransport = null;

const logger = winston.createLogger({
  level: config.app.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'whmcs-discord-sync', session: timestamp },
  transports: [
    new winston.transports.File({ 
      filename: combinedLogFile
    })
  ]
});

const originalError = logger.error.bind(logger);
logger.error = function(...args) {
  if (!errorTransport) {
    const errorLogFile = path.join(logDir, `error-${timestamp}.log`);
    errorTransport = new winston.transports.File({ 
      filename: errorLogFile, 
      level: 'error' 
    });
    logger.add(errorTransport);
  }
  
  return originalError(...args);
};

if (config.app.nodeEnv !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

module.exports = logger;