import cron from 'node-cron';
import config from '../config.js';
import logger from '../utils/logger.js';
import * as db from '../services/database.js';
import {
  getMarketSettledFromChain,
  processMarketAndSettleOnChain,
  fetchMissingMarketEndTimes,
  fetchMissingMarketQuestions
} from '../services/blockchain.js';

let isProcessing = false; // Simple lock to prevent concurrent processing
let isFetchingEndTimes = false; // Lock for fetching end times
let isFetchingQuestions = false; // Lock for fetching questions

// Function to display all markets sorted by end time
async function displayAllMarketsSortedByEndTime() {
  try {
    // Get all markets
    const allMarkets = await db.getAllMarkets();
    
    // Sort markets by end time (ascending)
    const sortedMarkets = allMarkets.sort((a, b) => {
      // Handle null endTimes by placing them at the end
      if (!a.marketEndTime) return 1;
      if (!b.marketEndTime) return -1;
      return a.marketEndTime - b.marketEndTime;
    });
    
    console.log('\n📊 ALL MARKETS (sorted by end time) 📊');
    console.log('Total markets: ' + sortedMarkets.length);
    console.log('──────────────────────────────────────────────────────────────────────────────');
    
    sortedMarkets.forEach((market, index) => {
      const endTimeStr = market.marketEndTime 
        ? new Date(market.marketEndTime * 1000).toISOString().replace('T', ' ').substring(0, 19)
        : 'No end time';
      
      const currentTime = Math.floor(Date.now() / 1000);
      const timeStatus = !market.marketEndTime ? '❓UNKNOWN' :
                        market.marketEndTime > currentTime ? '🟢ACTIVE' : '🔴ENDED';
      
      const questionPreview = market.marketQuestion 
        ? market.marketQuestion.substring(0, 70) + (market.marketQuestion.length > 70 ? '...' : '') 
        : 'No question';
      
      // Format for winning token based on availability
      let winningTokenDisplay = '---';
      if (market.winningTokenId !== null && market.winningTokenId !== undefined) {
        const shortTokenId = market.winningTokenId.length > 20 
          ? market.winningTokenId.substring(0, 8) + '...' + market.winningTokenId.substring(market.winningTokenId.length - 8)
          : market.winningTokenId;
        winningTokenDisplay = `🎯 ${shortTokenId}`;
      }

      console.log(
        `${(index + 1).toString().padStart(2)}. ${timeStatus} | ` +
        `End: ${endTimeStr} | ` + 
        `ID: ${market.conditionId.substring(0,10)}... | ` +
        `${market.processedForSettlement ? '✅' : '❌'} | ` +
        `Token: ${winningTokenDisplay}`
      );
      console.log(`   Q: ${questionPreview}`);
      if ((index + 1) % 5 === 0) {
        console.log('──────────────────────────────────────────────────────────────────────────────');
      }
    });
    console.log('──────────────────────────────────────────────────────────────────────────────\n');
  } catch (error) {
    logger.error({ error }, 'Error displaying all markets');
  }
}

// Function to reset a failed market's status to allow reprocessing
export async function resetFailedMarket(conditionId) {
  try {
    const market = await db.getMarket(conditionId);
    if (!market) {
      logger.error({ conditionId }, 'Cannot reset market - not found in database');
      return { success: false, error: 'Market not found' };
    }
    
    if (!market.processedForSettlement && market.retries > 0) {
      // It's a failed market, reset retry count and ensure it's not marked as processed
      await db.resetMarketProcessedStatus(conditionId);
      await db.resetMarketRetryCount(conditionId);
      
      logger.info({ conditionId }, 'Market reset successfully for reprocessing');
      return { success: true, message: 'Market reset for reprocessing' };
    } else if (market.processedForSettlement) {
      logger.warn({ conditionId }, 'Cannot reset market - already marked as processed');
      return { success: false, error: 'Market is already processed' };
    } else {
      logger.warn({ conditionId }, 'Cannot reset market - no failed attempts recorded');
      return { success: false, error: 'Market has no failed attempts' };
    }
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error resetting failed market');
    return { success: false, error: error.message || error };
  }
}

async function checkAndProcessMarkets() {
  if (isProcessing) {
    logger.warn('Market processing already in progress. Skipping this run.');
    return;
  }
  isProcessing = true;
  logger.info('Starting market processing job...');

  try {
    // Display all markets before processing
    await displayAllMarketsSortedByEndTime();
    
    const marketsToProcess = await db.getMarketsToProcess();
    logger.info(`Found ${marketsToProcess.length} markets due for processing.`);

    for (const market of marketsToProcess) {
      logger.info({ conditionId: market.conditionId }, 'Processing market...');

      // 1. Double-check on-chain settlement status before attempting to process
      let isSettled = await getMarketSettledFromChain(market.conditionId);
      if (isSettled) {
        logger.info({ conditionId: market.conditionId }, 'Market already settled on-chain. Marking as processed.');
        await db.setMarketProcessedForSettlement(market.conditionId); // Ensure our DB reflects this
        // db.updateMarketSettledOnChain is called by getMarketSettledFromChain
        continue; // Move to the next market
      }

      // 2. If not settled, attempt to process and settle
      logger.info({ conditionId: market.conditionId }, 'Market not settled on-chain. Attempting to process settlement.');
      const settlementResult = await processMarketAndSettleOnChain(market.conditionId);

      if (settlementResult.success) {
        logger.info({ 
          conditionId: market.conditionId, 
          alreadySettled: settlementResult.alreadySettled,
          result: settlementResult.result 
        }, 'Market processed and settled successfully.');
        // db.setMarketProcessedForSettlement is called by processMarketAndSettleOnChain on success
      } else {
        logger.error({ conditionId: market.conditionId, error: settlementResult.error }, 'Failed to process market.');
        // Implement retry logic or error marking in DB if needed
        // For now, it will be picked up in the next run if still applicable
      }
       // Small delay between processing each market to avoid overwhelming RPC/system
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    logger.error({ err: error }, 'Error during market processing job');
  } finally {
    isProcessing = false;
    logger.info('Market processing job finished.');
  }
}

async function checkAndFetchMissingEndTimes() {
    if (isFetchingEndTimes) {
        logger.warn('Fetching missing end times already in progress. Skipping.');
        return;
    }
    isFetchingEndTimes = true;
    logger.info('Starting job to fetch missing market end times...');
    try {
        // Display all markets before fetching missing end times
        await displayAllMarketsSortedByEndTime();
        
        await fetchMissingMarketEndTimes();
    } catch (error) {
        logger.error({ err: error }, 'Error during fetchMissingMarketEndTimes job');
    } finally {
        isFetchingEndTimes = false;
        logger.info('Fetching missing market end times job finished.');
    }
}

async function checkAndFetchMissingQuestions() {
    if (isFetchingQuestions) {
        logger.warn('Fetching missing questions already in progress. Skipping.');
        return;
    }
    isFetchingQuestions = true;
    logger.info('Starting job to fetch missing market questions...');
    try {
        // Display all markets before fetching missing questions
        await displayAllMarketsSortedByEndTime();
        
        await fetchMissingMarketQuestions();
    } catch (error) {
        logger.error({ err: error }, 'Error during fetchMissingMarketQuestions job');
    } finally {
        isFetchingQuestions = false;
        logger.info('Fetching missing market questions job finished.');
    }
}

export function startMarketProcessorJob() {
  const cronSchedule = config.MARKET_PROCESSOR_CRON_SCHEDULE;
  if (!cron.validate(cronSchedule)) {
    logger.error(`Invalid cron schedule: ${cronSchedule}. Market processor will not start.`);
    return;
  }

  logger.info(`Scheduling market processing job with cron schedule: ${cronSchedule}`);
  cron.schedule(cronSchedule, checkAndProcessMarkets);

  // Schedule fetching missing end times and questions
  const dataSyncSchedule = '*/2 * * * *'; // Every 2 minutes
  if (!cron.validate(dataSyncSchedule)) {
    logger.error(`Invalid cron schedule for data fetching: ${dataSyncSchedule}. Job will not start.`);
    return;
  }
  logger.info(`Scheduling job to fetch missing market data with cron schedule: ${dataSyncSchedule}`);
  cron.schedule(dataSyncSchedule, async () => {
    await checkAndFetchMissingEndTimes();
    // Wait a bit before starting the next job
    setTimeout(checkAndFetchMissingQuestions, 30000); // 30 seconds later
  });

  // Run once on startup as well after a short delay
  setTimeout(checkAndProcessMarkets, 5000);
  setTimeout(() => {
    checkAndFetchMissingEndTimes();
    setTimeout(checkAndFetchMissingQuestions, 15000);
  }, 2000);
} 