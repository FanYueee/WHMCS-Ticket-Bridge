// Console logger with timestamp
const getTimestamp = () => {
  const now = new Date();
  return `[${now.toLocaleTimeString('zh-TW', { hour12: false })}]`;
};

const log = (message) => {
  console.log(`${getTimestamp()} ${message}`);
};

const error = (message) => {
  console.error(`${getTimestamp()} ${message}`);
};

const warn = (message) => {
  console.warn(`${getTimestamp()} ${message}`);
};

module.exports = {
  log,
  error,
  warn
};