import { getMarketResolution } from './src/services/aiService.js';
import config from './src/config.js';
import logger from './src/utils/logger.js';
import { ethers } from 'ethers';
import fs from 'fs';
import { createRequire } from 'module';

// Create require function for importing JSON
const require = createRequire(import.meta.url);
const PNPFactoryABI = require('./src/abi/PNPFactory.json');

// Add your conditionIds here
const CONDITION_IDS = [
  "0x207d91b900fff61502bc01f798de519adb1ac5a49ba3d7c319fad5a11d049d37",
  "0xcc0979384c941f2a5eaa599abc0c782390ffd8a6ba40f3f24dc05e1871cdc21b",
  // Example:
  // "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  // "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
];

// Import the contract ABI and setup

let provider;
let pnpFactoryContract;

async function initializeContracts() {
  try {
    // Initialize RPC provider
    provider = new ethers.JsonRpcProvider(config.RPC_URL);
    logger.info('Connected to RPC provider');

    // Initialize PNP Factory contract
    pnpFactoryContract = new ethers.Contract(
      config.PNP_FACTORY_CONTRACT_ADDRESS,
      PNPFactoryABI,
      provider
    );
    logger.info('PNP Factory contract initialized');

    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize contracts');
    return false;
  }
}

async function fetchMarketData(conditionId) {
  try {
    logger.info({ conditionId }, 'Fetching market data from blockchain...');

    // Fetch market question
    const question = await pnpFactoryContract.marketQuestion(conditionId);
    if (!question || question.length === 0) {
      logger.warn({ conditionId }, 'Market question is empty or not found');
      return null;
    }

    // Fetch market end time
    const marketEndTimeBigInt = await pnpFactoryContract.getMarketEndTime(conditionId);
    const marketEndTime = Number(marketEndTimeBigInt);
    
    if (marketEndTime === 0) {
      logger.warn({ conditionId }, 'Market end time is zero or invalid');
      return null;
    }

    // Check if market is already settled
    const isSettled = await pnpFactoryContract.marketSettled(conditionId);
    
    logger.info({ 
      conditionId, 
      questionLength: question.length,
      marketEndTime: new Date(marketEndTime * 1000).toISOString(),
      isSettled 
    }, 'Market data fetched successfully');

    return {
      conditionId,
      question,
      marketEndTime,
      isSettled
    };
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error fetching market data');
    return null;
  }
}

async function processMarket(marketData) {
  const { conditionId, question, marketEndTime, isSettled } = marketData;

  try {
    logger.info({ conditionId }, 'Starting AI resolution analysis...');

    // Call AI resolution analysis (this will also store it in Supabase)
    const resolutionAnalysis = await getMarketResolution(question, marketEndTime, conditionId);

    if (!resolutionAnalysis) {
      logger.error({ conditionId }, 'Failed to get AI resolution analysis');
      return { success: false, error: 'AI analysis failed' };
    }

    logger.info({ 
      conditionId, 
      resolvable: resolutionAnalysis.resolvable 
    }, 'AI resolution analysis completed and stored successfully');

    return { success: true, data: resolutionAnalysis };
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error processing market');
    return { success: false, error: error.message };
  }
}

async function generateReport(results) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = `batch-resolution-report-${timestamp}.json`;

  const report = {
    timestamp: new Date().toISOString(),
    total_processed: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    resolvable_count: results.filter(r => r.success && r.resolvable === true).length,
    unresolvable_count: results.filter(r => r.success && r.resolvable === false).length,
    results: results
  };

  try {
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`📄 Report saved to: ${reportFile}`);
  } catch (error) {
    logger.error({ err: error }, 'Failed to save report');
  }

  return report;
}

async function main() {
  console.log('🚀 Starting batch resolution analysis...');
  console.log(`📊 Processing ${CONDITION_IDS.length} markets`);

  if (CONDITION_IDS.length === 0) {
    console.log('❌ No condition IDs provided. Please add them to the CONDITION_IDS array.');
    console.log('💡 Edit this file and add your conditionIds to the CONDITION_IDS array at the top.');
    process.exit(1);
  }

  // Initialize blockchain connections
  const initialized = await initializeContracts();
  if (!initialized) {
    console.log('❌ Failed to initialize blockchain contracts');
    process.exit(1);
  }

  const results = [];
  let processed = 0;

  for (const conditionId of CONDITION_IDS) {
    processed++;
    console.log(`\n[${processed}/${CONDITION_IDS.length}] Processing: ${conditionId}`);

    try {
      // Fetch market data from blockchain
      const marketData = await fetchMarketData(conditionId);
      
      if (!marketData) {
        results.push({
          conditionId,
          success: false,
          error: 'Failed to fetch market data from blockchain',
          timestamp: new Date().toISOString()
        });
        continue;
      }

      // Process with AI resolution analysis
      const result = await processMarket(marketData);
      
      results.push({
        conditionId,
        question: marketData.question.substring(0, 100) + (marketData.question.length > 100 ? '...' : ''),
        marketEndTime: new Date(marketData.marketEndTime * 1000).toISOString(),
        isSettled: marketData.isSettled,
        success: result.success,
        error: result.error || null,
        resolvable: result.data?.resolvable || null,
        reasoning: result.data?.reasoning ? result.data.reasoning.substring(0, 200) + '...' : null,
        timestamp: new Date().toISOString()
      });

      // Add delay between requests to avoid overwhelming services
      if (processed < CONDITION_IDS.length) {
        console.log('⏳ Waiting 3 seconds before next request...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

    } catch (error) {
      logger.error({ err: error, conditionId }, 'Unexpected error processing market');
      results.push({
        conditionId,
        success: false,
        error: `Unexpected error: ${error.message}`,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Generate and display report
  const report = await generateReport(results);
  
  console.log('\n📊 BATCH PROCESSING COMPLETE 📊');
  console.log('═══════════════════════════════════');
  console.log(`Total Processed: ${report.total_processed}`);
  console.log(`Successful: ${report.successful}`);
  console.log(`Failed: ${report.failed}`);
  console.log(`Resolvable Markets: ${report.resolvable_count}`);
  console.log(`Unresolvable Markets: ${report.unresolvable_count}`);
  console.log(`Success Rate: ${((report.successful / report.total_processed) * 100).toFixed(1)}%`);

  if (report.successful > 0) {
    const resolvabilityRate = ((report.resolvable_count / report.successful) * 100).toFixed(1);
    console.log(`Resolvability Rate: ${resolvabilityRate}%`);
  }

  if (report.failed > 0) {
    console.log('\n❌ Failed Markets:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.conditionId}: ${r.error}`);
    });
  }

  console.log('\n✅ Batch processing completed!');
  console.log(`📄 Detailed report saved to: batch-resolution-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⚠️ Received interrupt signal. Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection at Promise');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught Exception thrown');
  process.exit(1);
});

// Run the script
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});