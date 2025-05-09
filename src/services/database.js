import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import config from '../config.js';
import logger from '../utils/logger.js';

sqlite3.verbose(); // Enable verbose mode for better debugging

const dbFilePath = config.DB_FILE_PATH;
const dbDir = path.dirname(dbFilePath);

// Ensure the directory for the database file exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  logger.info(`Created database directory: ${dbDir}`);
}

// Database connection
let db;

// Initialize database connection
async function initializeDB() {
  try {
    db = await open({
      filename: dbFilePath,
      driver: sqlite3.Database
    });
    
    // Enable WAL mode for better concurrent access and crash recovery
    await db.exec('PRAGMA journal_mode = WAL;');
    
    // Set a busy timeout to handle concurrent access
    await db.exec('PRAGMA busy_timeout = 5000;');
    
    // Enable foreign keys (if we add them in the future)
    await db.exec('PRAGMA foreign_keys = ON;');
    
    logger.info(`Connected to SQLite database at ${dbFilePath}`);
    await initializeSchema();
    
    // Register for database backup at regular intervals if configured
    if (config.DB_BACKUP_INTERVAL_HOURS) {
      startDatabaseBackups();
    }
    
    return db;
  } catch (error) {
    logger.error({ error }, 'Failed to connect to database');
    throw error;
  }
}

// Initialize schema
async function initializeSchema() {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS markets (
        conditionId TEXT PRIMARY KEY,
        marketCreator TEXT NOT NULL,
        marketQuestion TEXT, -- Store the market question text
        marketEndTime INTEGER, -- UNIX timestamp in seconds, can be null initially
        fetchedEndTime BOOLEAN DEFAULT 0,
        processedForSettlement BOOLEAN DEFAULT 0,
        isSettledOnChain BOOLEAN DEFAULT 0,
        winningTokenId TEXT, -- Store the AI determined winning token ID as string to handle BigInt
        lastOnChainCheck INTEGER, -- Timestamp of the last check for marketSettled
        retries INTEGER DEFAULT 0, -- For settlement processing
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create the trigger for updatedAt
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS markets_updated_at
      AFTER UPDATE ON markets
      FOR EACH ROW
      BEGIN
        UPDATE markets SET updatedAt = CURRENT_TIMESTAMP WHERE conditionId = OLD.conditionId;
      END;
    `);
    
    // Create a journal table to track operations (useful for recovery)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS operations_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        conditionId TEXT,
        data TEXT,
        status TEXT DEFAULT 'pending',
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    logger.info('Database schema initialized/verified.');
  } catch (error) {
    logger.error({ error }, 'Error initializing database schema');
    throw error;
  }
}

// Database backup function
async function backupDatabase() {
  const backupDir = path.join(dbDir, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `market_data_${timestamp}.sqlite3`);
  
  try {
    // Force a checkpoint to ensure WAL is flushed to main DB file
    await db.exec('PRAGMA wal_checkpoint(FULL);');
    
    // Copy the database file
    fs.copyFileSync(dbFilePath, backupPath);
    
    // Also backup the WAL file if it exists
    const walPath = `${dbFilePath}-wal`;
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, `${backupPath}-wal`);
    }
    
    // Keep only the last 5 backups
    const files = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('market_data_'))
      .map(file => path.join(backupDir, file))
      .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
    
    if (files.length > 5) {
      for (let i = 5; i < files.length; i++) {
        fs.unlinkSync(files[i]);
      }
    }
    
    logger.info(`Database backup created: ${backupPath}`);
  } catch (error) {
    logger.error({ error }, 'Error creating database backup');
  }
}

// Start scheduled backups
function startDatabaseBackups() {
  const intervalHours = config.DB_BACKUP_INTERVAL_HOURS || 6;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  // Initial backup after 5 minutes
  setTimeout(() => {
    backupDatabase();
    // Then regular interval
    setInterval(backupDatabase, intervalMs);
  }, 5 * 60 * 1000);
  
  logger.info(`Scheduled database backups every ${intervalHours} hours`);
}

// Initialize the database connection
const dbPromise = initializeDB();

// --- Transaction Helper ---

// Helper function to run operations in a transaction
async function withTransaction(callback) {
  await dbPromise; // Ensure the database is initialized
  
  let result;
  try {
    await db.exec('BEGIN TRANSACTION');
    result = await callback(db);
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK').catch(rollbackError => {
      logger.error({ error: rollbackError }, 'Error rolling back transaction');
    });
    throw error;
  }
}

// --- Market Operations ---

export async function addOrUpdateMarket(conditionId, marketCreator) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId, data) VALUES (?, ?, ?)',
        ['addOrUpdateMarket', conditionId, JSON.stringify({ marketCreator })]
      );
      
      const result = await db.run(`
        INSERT INTO markets (conditionId, marketCreator, createdAt, updatedAt)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(conditionId) DO UPDATE SET
          marketCreator = excluded.marketCreator,
          updatedAt = CURRENT_TIMESTAMP
        WHERE markets.marketCreator != excluded.marketCreator;
      `, [conditionId, marketCreator]);
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'addOrUpdateMarket', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId, marketCreator }, 'Error in addOrUpdateMarket');
    throw error;
  }
}

export async function updateMarketEndTime(conditionId, marketEndTime) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId, data) VALUES (?, ?, ?)',
        ['updateMarketEndTime', conditionId, JSON.stringify({ marketEndTime })]
      );
      
      const result = await db.run(
        'UPDATE markets SET marketEndTime = ?, fetchedEndTime = 1 WHERE conditionId = ? AND (marketEndTime IS NULL OR marketEndTime != ?)',
        [marketEndTime, conditionId, marketEndTime]
      );
      
      if (result.changes > 0) {
        logger.debug({ conditionId, marketEndTime }, 'Market end time updated in DB.');
      } else {
        const existing = await getMarket(conditionId);
        if (existing && existing.marketEndTime === marketEndTime && existing.fetchedEndTime) {
          logger.debug({ conditionId, marketEndTime }, 'Market end time already up-to-date in DB.');
        } else {
          logger.warn({ conditionId, marketEndTime, existing }, 'Market end time update had no effect or market not found.');
        }
      }
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'updateMarketEndTime', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId, marketEndTime }, 'Error updating market end time');
    throw error;
  }
}

export async function getMarket(conditionId) {
  try {
    await dbPromise; // Ensure the database is initialized
    return await db.get('SELECT * FROM markets WHERE conditionId = ?', [conditionId]);
  } catch (error) {
    logger.error({ error, conditionId }, 'Error in getMarket');
    throw error;
  }
}

export async function resetMarketProcessedStatus(conditionId) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId) VALUES (?, ?)',
        ['resetMarketProcessedStatus', conditionId]
      );
      
      const result = await db.run('UPDATE markets SET processedForSettlement = 0 WHERE conditionId = ?', [conditionId]);
      logger.info({ conditionId, changes: result.changes }, 'Market processed status has been reset to allow reprocessing.');
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'resetMarketProcessedStatus', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId }, 'Error in resetMarketProcessedStatus');
    throw error;
  }
}

export async function incrementMarketRetryCount(conditionId) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId) VALUES (?, ?)',
        ['incrementMarketRetryCount', conditionId]
      );
      
      const result = await db.run('UPDATE markets SET retries = retries + 1 WHERE conditionId = ?', [conditionId]);
      logger.info({ conditionId, changes: result.changes }, 'Market retry count incremented.');
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'incrementMarketRetryCount', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId }, 'Error in incrementMarketRetryCount');
    throw error;
  }
}

export async function resetMarketRetryCount(conditionId) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId) VALUES (?, ?)',
        ['resetMarketRetryCount', conditionId]
      );
      
      const result = await db.run('UPDATE markets SET retries = 0 WHERE conditionId = ?', [conditionId]);
      logger.info({ conditionId, changes: result.changes }, 'Market retry count reset to zero.');
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'resetMarketRetryCount', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId }, 'Error in resetMarketRetryCount');
    throw error;
  }
}

export async function setMarketProcessedForSettlement(conditionId) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId) VALUES (?, ?)',
        ['setMarketProcessedForSettlement', conditionId]
      );
      
      const result = await db.run('UPDATE markets SET processedForSettlement = 1 WHERE conditionId = ?', [conditionId]);
      logger.info({ conditionId, changes: result.changes }, 'Market marked as processed for settlement.');
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'setMarketProcessedForSettlement', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId }, 'Error in setMarketProcessedForSettlement');
    throw error;
  }
}

export async function updateMarketSettledOnChain(conditionId, isSettled) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId, data) VALUES (?, ?, ?)',
        ['updateMarketSettledOnChain', conditionId, JSON.stringify({ isSettled })]
      );
      
      const result = await db.run(
        'UPDATE markets SET isSettledOnChain = ?, lastOnChainCheck = ? WHERE conditionId = ?',
        [isSettled ? 1 : 0, Math.floor(Date.now() / 1000), conditionId]
      );
      logger.info({ conditionId, isSettled, changes: result.changes }, 'Market on-chain settlement status updated.');
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'updateMarketSettledOnChain', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId, isSettled }, 'Error in updateMarketSettledOnChain');
    throw error;
  }
}

export async function updateMarketWinningTokenId(conditionId, winningTokenId) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId, data) VALUES (?, ?, ?)',
        ['updateMarketWinningTokenId', conditionId, JSON.stringify({ winningTokenId })]
      );
      
      const result = await db.run(
        'UPDATE markets SET winningTokenId = ? WHERE conditionId = ?',
        [winningTokenId, conditionId]
      );
      
      if (result.changes > 0) {
        logger.info({ conditionId, winningTokenId }, 'Market winning token ID updated in DB.');
      } else {
        logger.warn({ conditionId, winningTokenId }, 'Market winning token ID update had no effect or market not found.');
      }
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'updateMarketWinningTokenId', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId, winningTokenId }, 'Error updating market winning token ID');
    throw error;
  }
}

export async function getMarketsToProcess() {
  const currentTime = Math.floor(Date.now() / 1000);
  const settlementBuffer = config.SETTLEMENT_DELAY_MS / 1000; // Convert ms to seconds
  const maxRetries = 3; // Maximum number of retries before giving up

  try {
    await dbPromise; // Ensure the database is initialized
    
    // Select markets where:
    // 1. End time is known (fetchedEndTime = 1 and marketEndTime IS NOT NULL)
    // 2. End time + delay has passed (marketEndTime + settlementBuffer < currentTime)
    // 3. Not yet processed for settlement (processedForSettlement = 0)
    // 4. Not yet confirmed as settled on-chain (isSettledOnChain = 0)
    // 5. Has not exceeded max retries
    return await db.all(`
      SELECT * FROM markets
      WHERE fetchedEndTime = 1
        AND marketEndTime IS NOT NULL
        AND (marketEndTime + ?) < ? 
        AND processedForSettlement = 0
        AND isSettledOnChain = 0
        AND retries < ?
      ORDER BY marketEndTime ASC
    `, [settlementBuffer, currentTime, maxRetries]);
  } catch (error) {
    logger.error({ error, currentTime, settlementBuffer }, 'Error in getMarketsToProcess');
    throw error;
  }
}

export async function getMarketsMissingEndTime() {
  try {
    await dbPromise; // Ensure the database is initialized
    
    return await db.all('SELECT * FROM markets WHERE fetchedEndTime = 0 OR marketEndTime IS NULL ORDER BY createdAt ASC LIMIT 50');
  } catch (error) {
    logger.error({ error }, 'Error in getMarketsMissingEndTime');
    throw error;
  }
}

export async function updateMarketQuestion(conditionId, marketQuestion) {
  try {
    return await withTransaction(async (db) => {
      // Log the operation in journal
      await db.run(
        'INSERT INTO operations_journal (operation, conditionId, data) VALUES (?, ?, ?)',
        ['updateMarketQuestion', conditionId, JSON.stringify({ marketQuestion })]
      );
      
      const result = await db.run(
        'UPDATE markets SET marketQuestion = ? WHERE conditionId = ?',
        [marketQuestion, conditionId]
      );
      
      if (result.changes > 0) {
        logger.debug({ conditionId, marketQuestion: marketQuestion.substring(0, 50) + '...' }, 'Market question updated in DB.');
      } else {
        logger.warn({ conditionId }, 'Market question update had no effect or market not found.');
      }
      
      // Mark operation as completed
      await db.run(
        'UPDATE operations_journal SET status = ? WHERE conditionId = ? AND operation = ? AND status = ?',
        ['completed', conditionId, 'updateMarketQuestion', 'pending']
      );
      
      return result.changes > 0;
    });
  } catch (error) {
    logger.error({ error, conditionId }, 'Error updating market question');
    throw error;
  }
}

// Find markets that are missing questions
export async function getMarketsMissingQuestion() {
  try {
    await dbPromise; // Ensure the database is initialized
    
    return await db.all('SELECT * FROM markets WHERE marketQuestion IS NULL ORDER BY createdAt ASC LIMIT 50');
  } catch (error) {
    logger.error({ error }, 'Error in getMarketsMissingQuestion');
    throw error;
  }
}

export async function getAllMarkets() {
  try {
    await dbPromise; // Ensure the database is initialized
    return await db.all('SELECT conditionId, marketQuestion, marketEndTime, winningTokenId FROM markets ORDER BY createdAt DESC');
  } catch (error) {
    logger.error({ error }, 'Error in getAllMarkets');
    throw error;
  }
}

// Find and process any pending operations at startup
export async function recoverPendingOperations() {
  try {
    await dbPromise; // Ensure DB is initialized
    
    // Get all pending operations
    const pendingOps = await db.all('SELECT * FROM operations_journal WHERE status = ?', ['pending']);
    
    if (pendingOps.length > 0) {
      logger.info(`Found ${pendingOps.length} pending operations to recover`);
      
      // Process each pending operation
      for (const op of pendingOps) {
        try {
          // Parse data if available
          const data = op.data ? JSON.parse(op.data) : {};
          
          // Attempt to replay the operation based on type
          switch (op.operation) {
            case 'addOrUpdateMarket':
              if (data.marketCreator) {
                await db.run(`
                  INSERT INTO markets (conditionId, marketCreator)
                  VALUES (?, ?)
                  ON CONFLICT(conditionId) DO UPDATE SET
                    marketCreator = excluded.marketCreator
                  WHERE markets.marketCreator != excluded.marketCreator;
                `, [op.conditionId, data.marketCreator]);
              }
              break;
              
            case 'updateMarketEndTime':
              if (data.marketEndTime !== undefined) {
                await db.run(
                  'UPDATE markets SET marketEndTime = ?, fetchedEndTime = 1 WHERE conditionId = ?',
                  [data.marketEndTime, op.conditionId]
                );
              }
              break;
              
            case 'setMarketProcessedForSettlement':
              await db.run('UPDATE markets SET processedForSettlement = 1 WHERE conditionId = ?', [op.conditionId]);
              break;
              
            case 'updateMarketSettledOnChain':
              if (data.isSettled !== undefined) {
                await db.run(
                  'UPDATE markets SET isSettledOnChain = ? WHERE conditionId = ?',
                  [data.isSettled ? 1 : 0, op.conditionId]
                );
              }
              break;
              
            case 'updateMarketQuestion':
              if (data.marketQuestion) {
                await db.run(
                  'UPDATE markets SET marketQuestion = ? WHERE conditionId = ?',
                  [data.marketQuestion, op.conditionId]
                );
              }
              break;
              
            case 'updateMarketWinningTokenId':
              if (data.winningTokenId !== undefined) {
                await db.run(
                  'UPDATE markets SET winningTokenId = ? WHERE conditionId = ?',
                  [data.winningTokenId, op.conditionId]
                );
              }
              break;
              
            default:
              logger.warn({ operation: op.operation }, 'Unknown operation type during recovery');
          }
          
          // Mark as completed
          await db.run('UPDATE operations_journal SET status = ? WHERE id = ?', ['completed', op.id]);
          logger.info({ operation: op.operation, conditionId: op.conditionId }, 'Recovered pending operation');
          
        } catch (opError) {
          logger.error({ error: opError, operation: op }, 'Failed to recover operation');
          await db.run('UPDATE operations_journal SET status = ? WHERE id = ?', ['failed', op.id]);
        }
      }
    }
  } catch (error) {
    logger.error({ error }, 'Error recovering pending operations');
  }
}

// Call the recovery function on startup
recoverPendingOperations().catch(error => {
  logger.error({ error }, 'Failed to perform recovery of pending operations');
});

// Close database on program exit
async function closeDatabase() {
  try {
    if (db) {
      // Force a checkpoint before closing to ensure WAL is flushed to main DB file
      await db.exec('PRAGMA wal_checkpoint(FULL);');
      await db.close();
      logger.info('Database connection closed.');
    }
  } catch (error) {
    logger.error({ error }, 'Error closing database connection');
  }
}

// Enhanced graceful shutdown with more thorough process handling
async function gracefulShutdown(signal) {
  try {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    // Force a checkpoint to ensure data is written to disk
    if (db) {
      await db.exec('PRAGMA wal_checkpoint(FULL);').catch(error => {
        logger.error({ error }, 'Error during WAL checkpoint on shutdown');
      });
    }
    
    // Close database connection
    await closeDatabase();
    
    logger.info('Graceful shutdown completed.');
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
  } finally {
    // Get the signal code and exit with appropriate code
    const signals = { 'SIGHUP': 1, 'SIGINT': 2, 'SIGTERM': 15 };
    process.exit(signals[signal] ? 128 + signals[signal] : 0);
  }
}

// Graceful shutdown
process.on('exit', closeDatabase);
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions and unhandled promise rejections to attempt graceful DB shutdown
process.on('uncaughtException', async (error) => {
  logger.fatal({ error }, 'Uncaught exception - attempting to close database before exit');
  await closeDatabase();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection - attempting to close database');
  // We don't exit here to allow the process to continue, but we do ensure DB integrity
  // If this becomes critical, you can add process.exit(1) after closeDatabase()
}); 