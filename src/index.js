import logger from './utils/logger.js';
import config from './config.js'; // Loads .env and validates config
import {
  initializeBlockchainService,
  syncPastMarketCreatedEvents,
  listenForMarketCreatedEvents,
} from './services/blockchain.js';
import { startMarketProcessorJob, resetFailedMarket } from './jobs/marketProcessor.js';
// Import database to ensure it's initialized
import * as database from './services/database.js';

// Handle CLI commands
async function handleCliCommands() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    // Check for reset-market command
    if (args[0] === 'reset-market' && args[1]) {
      const conditionId = args[1];
      logger.info({ conditionId }, 'Attempting to reset failed market...');
      
      try {
        // Initialize DB and blockchain service first
        await database.recoverPendingOperations();
        await initializeBlockchainService();
        
        const result = await resetFailedMarket(conditionId);
        if (result.success) {
          logger.info({ conditionId, result }, 'Market reset successful');
        } else {
          logger.error({ conditionId, error: result.error }, 'Failed to reset market');
        }
        process.exit(result.success ? 0 : 1);
      } catch (error) {
        logger.error({ err: error, conditionId }, 'Error during market reset');
        process.exit(1);
      }
      
      // This return is now inside a function, so it's legal
      return true; // Indicates command was handled
    }
  }
  return false; // No command was handled
}

async function main() {
  console.log("DEBUG: main() function entered"); // Added for debugging
  // First check if there's a CLI command to handle
  const cliCommandHandled = await handleCliCommands();
  console.log(`DEBUG: handleCliCommands() completed, result: ${cliCommandHandled}`); // Added for debugging
  if (cliCommandHandled) {
    return; // Exit if CLI command was handled
  }

  logger.info('Starting EVM Market Indexer...');
  logger.info(`Application Mode: ${config.NODE_ENV}`);

  try {
    // Initialize database first (dbPromise resolves)
    await database.recoverPendingOperations(); // Ensure recovery is attempted early
    logger.info('Database service initialized and recovery attempted.');

    // 1. Initialize Blockchain Service (connect to RPC, setup wallet, contract)
    await initializeBlockchainService();
    logger.info('Blockchain service ready.');

    // 2. Sync past events (if START_BLOCK is configured or from beginning)
    // This is crucial for resilience and to catch up on missed events if the script was down.
    // await syncPastMarketCreatedEvents(); // DISABLED: Skip fetching previous markets
    logger.info('Skipped syncing past market events (disabled).');

    // Log all stored market questions after initial sync
    try {
      const allMarkets = await database.getAllMarkets();
      if (allMarkets && allMarkets.length > 0) {
        logger.info(`--- Stored Market Questions (${allMarkets.length} total) ---`);
        allMarkets.forEach(market => {
          logger.info({
            conditionId: market.conditionId,
            question: market.marketQuestion ? market.marketQuestion.substring(0, 150) + (market.marketQuestion.length > 150 ? '...':'') : '[NO QUESTION STORED]',
            endTime: market.marketEndTime ? new Date(market.marketEndTime * 1000).toISOString() : '[NO END TIME]'
          });
        });
        logger.info(`--- End of Stored Market Questions ---`);
      } else {
        logger.info('No markets found in the database to log questions for.');
      }
    } catch (error) {
      logger.error({error}, 'Failed to fetch and log all market questions.');
    }

    // 3. Start listening for real-time MarketCreated events
    listenForMarketCreatedEvents();
    logger.info('Now listening for live MarketCreated events.');

    // 4. Start the Market Processor Job (periodically checks DB for markets to settle)
    startMarketProcessorJob();
    logger.info('Market processor job scheduled.');

    logger.info('EVM Market Indexer started successfully and is running.');

  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start the EVM Market Indexer');
    process.exit(1);
  }
}

console.log("DEBUG: index.js script started, before main()"); // Added for debugging
main();

// Graceful shutdown handling
const signals = { 'SIGHUP': 1, 'SIGINT': 2, 'SIGTERM': 15 };
Object.keys(signals).forEach((signal) => {
  process.on(signal, () => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    // Add any specific cleanup tasks here if needed before exiting
    // The database connection closes on 'exit' event (handled in database.js)
    // cron jobs are automatically stopped when the process exits
    process.exit(128 + signals[signal]);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection at Promise');
  // Consider a more graceful shutdown or specific error handling
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception thrown');
  process.exit(1); // Mandatory exit after uncaught exception
}); 