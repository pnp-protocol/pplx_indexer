import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define paths to try for .env file
const possiblePaths = [
  path.resolve(__dirname, '../.env'),        // src/../.env
  path.resolve(__dirname, '../../.env'),     // Original path being used
  path.resolve(process.cwd(), '.env'),       // Current working directory
];

let envPath = null;
// Find the first path that exists
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    envPath = p;
    break;
  }
}

if (!envPath) {
  console.error(`Could not find .env file. Tried paths:`, possiblePaths);
  console.error(`Current directory: ${process.cwd()}`);
  process.exit(1);
}

// Load .env file from the found path
console.log(`Loading .env file from: ${envPath}`);
dotenv.config({ path: envPath });

const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
  LOG_FILE_PATH: process.env.LOG_FILE_PATH || './logs/indexer.log',
  RPC_URL: process.env.RPC_URL,
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  SETTLER_PRIVATE_KEY: process.env.SETTLER_PRIVATE_KEY,
  PNP_FACTORY_CONTRACT_ADDRESS: process.env.PNP_FACTORY_CONTRACT_ADDRESS,
  PPLX_API_KEY: process.env.PPLX_API_KEY,
  SETTLEMENT_DELAY_MINUTES: parseInt(process.env.SETTLEMENT_DELAY_MINUTES || '2', 10),
  get SETTLEMENT_DELAY_MS() {
    return this.SETTLEMENT_DELAY_MINUTES * 60 * 1000;
  },
  START_BLOCK: process.env.START_BLOCK ? parseInt(process.env.START_BLOCK, 10) : 0,
  MARKET_PROCESSOR_CRON_SCHEDULE: process.env.MARKET_PROCESSOR_CRON_SCHEDULE || '*/1 * * * *',
  DB_FILE_PATH: process.env.DB_FILE_PATH || './data/market_data.sqlite3',
  DB_BACKUP_INTERVAL_HOURS: parseInt(process.env.DB_BACKUP_INTERVAL_HOURS || '6', 10),
};

// Validate essential configurations
const requiredConfigs = [
  'RPC_URL',
  'PRIVATE_KEY',
  'SETTLER_PRIVATE_KEY',
  'PNP_FACTORY_CONTRACT_ADDRESS',
  'PPLX_API_KEY',
];

const missingConfigs = requiredConfigs.filter(key => !config[key]);

if (missingConfigs.length > 0) {
  console.error(`FATAL ERROR: Missing critical environment variables: ${missingConfigs.join(', ')}`);
  console.error('Please ensure they are set in your .env file.');
  process.exit(1);
}

export default config; 