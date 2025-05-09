import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';
import logger from '../utils/logger.js';
import * as db from './database.js';
import { getMarketSettlementAnalysis } from './aiService.js'; // Import the AI service

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PNPFactoryAbi = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../abi/PNPFactory.json'), 'utf-8'));

let provider;
let wallet;
let pnpFactoryContract;

export function getContract() {
  if (!pnpFactoryContract) {
    throw new Error('Blockchain service not initialized. Call initializeBlockchainService first.');
  }
  return pnpFactoryContract;
}

export function getProvider() {
  if (!provider) {
    throw new Error('Blockchain service not initialized. Call initializeBlockchainService first.');
  }
  return provider;
}

export function getWallet() {
  if (!wallet) {
    throw new Error('Blockchain service not initialized. Call initializeBlockchainService first.');
  }
  return wallet;
}

export async function initializeBlockchainService() {
  try {
    logger.info(`Connecting to RPC URL: ${config.RPC_URL}`);
    provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const network = await provider.getNetwork();
    logger.info(`Connected to network: ${network.name} (Chain ID: ${network.chainId})`);

    wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    logger.info(`Wallet initialized for address: ${wallet.address}`);

    pnpFactoryContract = new ethers.Contract(
      config.PNP_FACTORY_CONTRACT_ADDRESS,
      PNPFactoryAbi,
      wallet // Connect wallet for sending transactions
    );
    logger.info(`PNPFactory contract initialized at address: ${await pnpFactoryContract.getAddress()}`);
    logger.info('Blockchain service initialized successfully.');
  } catch (error) {
    logger.error({ err: error }, 'Error initializing blockchain service');
    throw error; // Rethrow to be handled by the main application
  }
}

async function fetchAndStoreMarketEndTime(conditionId) {
  try {
    logger.debug({ conditionId }, 'Fetching market end time from contract...');
    const marketEndTimeBigInt = await pnpFactoryContract.getMarketEndTime(conditionId);
    const marketEndTime = Number(marketEndTimeBigInt); // Convert BigInt to Number (timestamp in seconds)

    if (marketEndTime > 0) {
      await db.updateMarketEndTime(conditionId, marketEndTime);
      logger.info({ conditionId, marketEndTime }, 'Market end time fetched and stored.');
    } else {
      logger.warn({ conditionId }, 'Fetched market end time is 0 or invalid.');
    }
    return marketEndTime;
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error fetching or storing market end time');
    // Potentially add to a retry queue or mark for later fetching
    return null;
  }
}

async function fetchAndStoreMarketQuestion(conditionId) {
  try {
    logger.debug({ conditionId }, 'Fetching market question from contract...');
    const question = await pnpFactoryContract.marketQuestion(conditionId);
    
    if (question && question.length > 0) {
      await db.updateMarketQuestion(conditionId, question);
      logger.info({ conditionId, questionLength: question.length }, 'Market question fetched and stored.');
      return question;
    } else {
      logger.warn({ conditionId }, 'Fetched market question is empty or invalid.');
      return null;
    }
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error fetching or storing market question');
    return null;
  }
}

async function fetchAndRecordPreSettledMarketDetails(conditionId) {
  if (!pnpFactoryContract) throw new Error('Contract not initialized');
  try {
    const isAlreadySettled = await pnpFactoryContract.marketSettled(conditionId);
    if (isAlreadySettled) {
      logger.info({ conditionId }, "Market found to be already settled on-chain during indexing.");
      await db.updateMarketSettledOnChain(conditionId, true);
      await db.setMarketProcessedForSettlement(conditionId); // Mark as processed to avoid AI settlement

      try {
        // Attempt to get the winning token ID from the public mapping getter
        const winningTokenIdBigInt = await pnpFactoryContract.winningTokenId(conditionId);
        const winningTokenIdStr = winningTokenIdBigInt.toString();
        
        if (winningTokenIdBigInt !== undefined) { // Assuming 0 could be a valid token ID, check for undefined
          await db.updateMarketWinningTokenId(conditionId, winningTokenIdStr);
          logger.info({ conditionId, winningTokenId: winningTokenIdStr }, "Successfully fetched and stored winningTokenId for pre-settled market.");
        } else {
          logger.warn({ conditionId }, "Market is settled, but winningTokenId could not be retrieved (returned undefined). It might not be set or getter is not available as expected.");
        }
      } catch (error) {
        logger.warn({ err: error, conditionId }, "Market is settled, but failed to fetch winningTokenId. The contract might not have a public 'winningTokenId(conditionId)' getter or ABI is outdated.");
        // Even if we can't get winningTokenId, we know it's settled.
      }
      return true; // Market was pre-settled
    }
    return false; // Market was not pre-settled
  } catch (error) {
    logger.error({ err: error, conditionId }, "Error checking or recording pre-settled market details.");
    return false; // Assume not settled on error to allow normal processing flow
  }
}

export async function syncPastMarketCreatedEvents() {
  if (!pnpFactoryContract) throw new Error('Contract not initialized');

  const startBlock = config.START_BLOCK || 0;
  logger.info(`Starting sync of past PNP_MarketCreated events from block ${startBlock}...`);

  try {
    const eventFilter = pnpFactoryContract.filters.PNP_MarketCreated();
    const events = await pnpFactoryContract.queryFilter(eventFilter, startBlock, 'latest');

    logger.info(`Found ${events.length} past PNP_MarketCreated events.`);

    for (const event of events) {
      if (event.args && event.args.conditionId && event.args.marketCreator) {
        const { conditionId, marketCreator } = event.args;
        logger.info({ conditionId, marketCreator, blockNumber: event.blockNumber }, 'Processing past event');
        await db.addOrUpdateMarket(conditionId, marketCreator);
        
        // Check if market was already settled and try to fetch its winningTokenId
        const wasPreSettled = await fetchAndRecordPreSettledMarketDetails(conditionId);

        const market = await db.getMarket(conditionId);
        if (market) {
          // Fetch end time if needed (always useful to have)
          if (!market.fetchedEndTime) {
            await fetchAndStoreMarketEndTime(conditionId);
          }
          // Fetch market question if needed (always useful to have)
          if (!market.marketQuestion) {
            await fetchAndStoreMarketQuestion(conditionId);
          }
        }
      } else {
        logger.warn({ event }, 'Skipping past event due to missing args');
      }
    }
    logger.info('Finished syncing past PNP_MarketCreated events.');
  } catch (error) {
    logger.error({ err: error }, 'Error syncing past PNP_MarketCreated events');
  }
}

export function listenForMarketCreatedEvents() {
  if (!pnpFactoryContract) throw new Error('Contract not initialized');

  logger.info('Listening for new PNP_MarketCreated events...');
  pnpFactoryContract.on('PNP_MarketCreated', async (conditionId, marketCreator, event) => {
    logger.info(
      { 
        conditionId,
        marketCreator,
        blockNumber: event.log.blockNumber,
        txHash: event.log.transactionHash 
      },
      'PNP_MarketCreated event received'
    );
    try {
      await db.addOrUpdateMarket(conditionId, marketCreator);
      
      // Check if market was already settled and try to fetch its winningTokenId
      const wasPreSettled = await fetchAndRecordPreSettledMarketDetails(conditionId);

      // Always fetch end time and question for new live events for completeness,
      // even if pre-settled (though unlikely for a brand new event).
      // The fetchAndRecordPreSettledMarketDetails would have already updated settlement status and winningTokenId if applicable.
      await fetchAndStoreMarketEndTime(conditionId);
      await fetchAndStoreMarketQuestion(conditionId);

      if (wasPreSettled) {
        logger.info({ conditionId }, "Live event for a market that was already settled has been fully recorded (including endTime/Question if missing).");
      }

    } catch (error) {
      logger.error({ err: error, conditionId, marketCreator }, 'Error processing PNP_MarketCreated event');
    }
  });

  // It's good practice to also listen for errors on the provider or contract
  provider.on('error', (error) => {
    logger.error({ err: error }, 'Provider error detected');
    // You might want to re-initialize or exit depending on the error
  });

  pnpFactoryContract.on('error', (error) => {
    logger.error({ err: error }, 'Contract event listener error');
  });
}

export async function getMarketSettledFromChain(conditionId) {
  if (!pnpFactoryContract) throw new Error('Contract not initialized');
  try {
    logger.debug({ conditionId }, 'Checking on-chain settlement status...');
    const isSettled = await pnpFactoryContract.marketSettled(conditionId);
    logger.info({ conditionId, isSettled }, 'On-chain settlement status fetched.');
    await db.updateMarketSettledOnChain(conditionId, isSettled);
    return isSettled;
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error fetching marketSettled from chain');
    throw error; // Rethrow to be handled by caller
  }
}

export async function processMarketAndSettleOnChain(conditionId) {
  if (!pnpFactoryContract || !wallet) throw new Error('Contract or wallet not initialized');
  logger.info({ conditionId }, 'Processing market settlement...');

  try {
    // Check if the market is already settled
    const isSettled = await pnpFactoryContract.marketSettled(conditionId);
    if (isSettled) {
      logger.info({ conditionId }, 'Market is already settled on-chain.');
      await db.setMarketProcessedForSettlement(conditionId);
      await db.updateMarketSettledOnChain(conditionId, true);
      return { success: true, alreadySettled: true };
    }

    // Get market details from database
    const market = await db.getMarket(conditionId);
    if (!market) {
      logger.error({ conditionId }, 'Market not found in database.');
      return { success: false, error: 'Market not found in database' };
    }

    // Verify we have the market question
    if (!market.marketQuestion) {
      logger.warn({ conditionId }, 'Market question is missing. Fetching before processing.');
      await fetchAndStoreMarketQuestion(conditionId);
      // Get updated market record
      const updatedMarket = await db.getMarket(conditionId);
      if (!updatedMarket || !updatedMarket.marketQuestion) {
        logger.error({ conditionId }, 'Failed to retrieve market question, cannot proceed with settlement.');
        return { success: false, error: 'Missing market question' };
      }
      market.marketQuestion = updatedMarket.marketQuestion;
    }

    // Get market end time to validate it has passed
    const marketEndTimeBigInt = await pnpFactoryContract.getMarketEndTime(conditionId);
    const marketEndTime = Number(marketEndTimeBigInt);
    const currentTime = Math.floor(Date.now() / 1000);
    
    if (marketEndTime === 0) {
      logger.warn({ conditionId }, 'Market end time is zero or invalid, cannot process.');
      return { success: false, error: 'Invalid market end time' };
    }
    
    if (marketEndTime > currentTime) {
      logger.warn({ conditionId, marketEndTime, currentTime }, 'Market end time has not passed yet.');
      return { success: false, error: 'Market end time has not passed yet' };
    }

    // Check if enough time has passed after market end
    const settlementDelay = config.SETTLEMENT_DELAY_MS / 1000;
    if (currentTime < marketEndTime + settlementDelay) {
      const waitTimeRemaining = (marketEndTime + settlementDelay) - currentTime;
      logger.info({ conditionId, waitTimeRemaining }, 'Waiting period after market end has not completed.');
      return { success: false, error: `Settlement delay not met, ${waitTimeRemaining} seconds remaining` };
    }

    // Execute settlement logic
    logger.info({ 
      conditionId, 
      marketQuestion: market.marketQuestion.substring(0, 100) + (market.marketQuestion.length > 100 ? '...' : ''),
      marketEndTime: new Date(marketEndTime * 1000).toISOString()
    }, 'Executing market settlement logic...');
    
    const settlementResult = await executeSettlementLogic(conditionId, market.marketQuestion, marketEndTime);
    
    // Check if executeSettlementLogic (which includes on-chain settlement) was successful
    if (settlementResult.success && settlementResult.winningTokenId) {
      // All successful (AI + On-chain settlement)
      await db.setMarketProcessedForSettlement(conditionId);
      await db.updateMarketSettledOnChain(conditionId, true); // Mark as settled on-chain in our DB
      await db.updateMarketWinningTokenId(conditionId, settlementResult.winningTokenId); // Save the string token ID
      
      logger.info({ 
        conditionId: conditionId,
        winningTokenId: settlementResult.winningTokenId,
        aiAnswer: settlementResult.aiAnswer,
        txHash: settlementResult.txHash
      }, "Market processed, settled on-chain, and DB updated.");

      // User-friendly console output for final confirmation
      console.log('\n✅ MARKET FULLY SETTLED & RECORDED ✅');
      console.log(`ConditionID: ${conditionId}`);
      console.log(`Outcome: ${settlementResult.aiAnswer} (Token ID: ${settlementResult.winningTokenId})`);
      console.log(`On-Chain TX: ${settlementResult.txHash}`);
      console.log('----------------------------------------\n');
      
      return { success: true, result: settlementResult };
    } else {
      // AI analysis or on-chain settlement failed
      logger.error({
        conditionId,
        error: settlementResult.message,
        aiResponse: settlementResult.aiAnswer, // Log AI answer even if tx failed
        errorDetails: settlementResult.errorDetails
      }, 'Failed to fully settle market (AI or On-Chain failure).');
      
      await db.incrementMarketRetryCount(conditionId);
      // DO NOT mark as processedForSettlement or settledOnChain if the on-chain part failed.
      // It will be retried.
      
      return { 
        success: false, 
        error: settlementResult.message || 'Unknown error during settlement execution.',
        needsRetry: true
      };
    }
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error processing market settlement');
    return { success: false, error: error.message || error };
  }
}

// Gets the token ID for a "YES" outcome from the smart contract
export async function getYesTokenId(conditionId) {
  if (!pnpFactoryContract) throw new Error('Contract not initialized');
  try {
    const tokenId = await pnpFactoryContract.getYesTokenId(conditionId);
    logger.info({ conditionId, tokenId: tokenId.toString() }, 'Fetched YES token ID from contract.');
    return tokenId; // This will be a BigInt
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error fetching YES token ID from contract');
    throw error;
  }
}

// Gets the token ID for a "NO" outcome from the smart contract
export async function getNoTokenId(conditionId) {
  if (!pnpFactoryContract) throw new Error('Contract not initialized');
  try {
    const tokenId = await pnpFactoryContract.getNoTokenId(conditionId);
    logger.info({ conditionId, tokenId: tokenId.toString() }, 'Fetched NO token ID from contract.');
    return tokenId; // This will be a BigInt
  } catch (error) {
    logger.error({ err: error, conditionId }, 'Error fetching NO token ID from contract');
    throw error;
  }
}

// This function would contain your custom settlement logic
async function executeSettlementLogic(conditionId, marketQuestion, marketEndTime) {
  logger.info({ 
    conditionId, 
    marketQuestionShort: marketQuestion.substring(0,100) + (marketQuestion.length > 100 ? '...' : ''),
    marketEndTime: new Date(marketEndTime * 1000).toISOString()
  }, 'Market data for settlement processing using AI.');

  const outcomes = ["YES", "NO"];
  const aiAnalysis = await getMarketSettlementAnalysis(marketQuestion, outcomes);

  if (aiAnalysis && aiAnalysis.answer) {
    let winningTokenIdBigInt; // Keep as BigInt for contract call
    if (aiAnalysis.answer.toUpperCase() === "YES") {
      winningTokenIdBigInt = await getYesTokenId(conditionId);
    } else if (aiAnalysis.answer.toUpperCase() === "NO") {
      winningTokenIdBigInt = await getNoTokenId(conditionId);
    } else {
      logger.error({ conditionId, aiAnswer: aiAnalysis.answer }, 'AI answer is not YES or NO.');
      return { success: false, message: 'AI answer is not YES or NO.' };
    }

    const winningTokenIdStr = winningTokenIdBigInt.toString();
    logger.info({
      conditionId,
      aiAnswer: aiAnalysis.answer,
      winningTokenId: winningTokenIdStr
    }, 'AI analysis complete, proceeding to on-chain settlement.');

    try {
      // Create settler wallet and contract instance
      if (!config.SETTLER_PRIVATE_KEY) {
        logger.error('SETTLER_PRIVATE_KEY is not configured in .env. Cannot settle market.');
        return { success: false, message: 'Settler private key not configured.' };
      }
      const settlerWallet = new ethers.Wallet(config.SETTLER_PRIVATE_KEY, provider);
      const settlerContract = pnpFactoryContract.connect(settlerWallet);

      logger.info({ conditionId, winningTokenId: winningTokenIdStr, settlerAddress: settlerWallet.address }, 
        `Attempting to call settleMarket with token ID ${winningTokenIdStr}`
      );

      // Call settleMarket on the contract
      const tx = await settlerContract.settleMarket(conditionId, winningTokenIdBigInt); // Use BigInt for contract call
      logger.info({ conditionId, txHash: tx.hash }, 'settleMarket transaction sent. Waiting for confirmation...');
      
      const receipt = await tx.wait(1); // Wait for 1 confirmation
      logger.info({ conditionId, txHash: receipt.hash, blockNumber: receipt.blockNumber }, 
        'settleMarket transaction confirmed!'
      );

      // Add a clear console output for user visibility
      console.log('\n==== ON-CHAIN SETTLEMENT INITIATED ====');
      console.log(`Market Question: ${marketQuestion}`);
      console.log(`AI Answer: ${aiAnalysis.answer}`);
      console.log(`Winning Token ID: ${winningTokenIdStr}`);
      console.log(`Settler Address: ${settlerWallet.address}`);
      console.log(`Transaction Hash: ${receipt.hash}`);
      console.log(`Block Number: ${receipt.blockNumber}`);
      console.log('=======================================\n');

      return { 
        success: true, 
        message: 'On-chain settlement transaction successful.',
        aiAnswer: aiAnalysis.answer,
        aiReasoning: aiAnalysis.reasoning, // Keep full reasoning for potential later use
        winningTokenId: winningTokenIdStr, // Return string for DB and logging consistency
        txHash: receipt.hash
      };

    } catch (contractError) {
      logger.error({ err: contractError, conditionId, winningTokenId: winningTokenIdStr }, 
        'Error calling settleMarket on contract'
      );
      return { 
        success: false, 
        message: `Failed to call settleMarket: ${contractError.message}`,
        errorDetails: contractError
      };
    }

  } else {
    logger.error({ conditionId }, 'Failed to get a valid analysis from AI service.');
    return { success: false, message: 'Failed to get AI analysis.' };
  }
}

export async function fetchMissingMarketEndTimes() {
    const markets = await db.getMarketsMissingEndTime();
    if (markets.length === 0) {
        // logger.debug('No markets missing end times.');
        return;
    }
    logger.info(`Found ${markets.length} markets missing end times. Fetching...`);
    for (const market of markets) {
        await fetchAndStoreMarketEndTime(market.conditionId);
        // Add a small delay to avoid overwhelming the RPC endpoint if there are many
        await new Promise(resolve => setTimeout(resolve, 200)); 
    }
}

export async function fetchMissingMarketQuestions() {
    const markets = await db.getMarketsMissingQuestion();
    if (markets.length === 0) {
        // logger.debug('No markets missing questions.');
        return;
    }
    logger.info(`Found ${markets.length} markets missing questions. Fetching...`);
    for (const market of markets) {
        await fetchAndStoreMarketQuestion(market.conditionId);
        // Add a small delay to avoid overwhelming the RPC endpoint if there are many
        await new Promise(resolve => setTimeout(resolve, 200)); 
    }
} 