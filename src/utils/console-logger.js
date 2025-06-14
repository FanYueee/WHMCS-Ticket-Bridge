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