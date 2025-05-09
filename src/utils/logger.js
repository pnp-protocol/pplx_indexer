import pino from 'pino';
import config from '../config.js';

// Simplified logger for debugging console output
const logger = pino({
  level: config.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      sync: true, // Try with and without sync if issues persist
      levelFirst: false
    }
  }
});

export default logger; 