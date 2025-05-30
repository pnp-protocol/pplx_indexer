import { createClient } from '@supabase/supabase-js';
import config from '../config.js';
import logger from '../utils/logger.js';

// Initialize the Supabase client
const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);

/**
 * Stores AI reasoning for a market condition in Supabase
 * @param {string} conditionId - The ID of the market condition
 * @param {string} question - The market question
 * @param {string} answer - The AI's answer (YES/NO)
 * @param {string} reasoning - The AI's detailed reasoning
 * @param {string} [marketCreationTime] - Optional market creation timestamp
 * @param {string} [settlementTime] - Optional settlement timestamp
 * @returns {Promise<Object>} - The inserted or updated record
 */
export async function storeAIReasoning(conditionId, question, answer, reasoning, marketCreationTime, settlementTime) {
  try {
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      logger.warn('Supabase configuration is missing. Skipping AI reasoning storage.');
      return null;
    }

    const record = {
      condition_id: conditionId,
      question,
      answer,
      reasoning,
      created_at: new Date().toISOString(),
      market_creation_time: marketCreationTime || null,
      settlement_time: settlementTime || null
    };

    // First, check if a record with this condition_id already exists
    const { data: existingRecord, error: selectError } = await supabase
      .from(config.SUPABASE_TABLE_NAME)
      .select('id')
      .eq('condition_id', conditionId)
      .maybeSingle();

    let result;
    
    if (existingRecord) {
      // Update existing record
      const { data, error } = await supabase
        .from(config.SUPABASE_TABLE_NAME)
        .update(record)
        .eq('condition_id', conditionId)
        .select();
      
      if (error) throw error;
      result = data[0];
      logger.info({ conditionId }, 'Updated AI reasoning in Supabase');
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from(config.SUPABASE_TABLE_NAME)
        .insert([record])
        .select();
      
      if (error) throw error;
      result = data[0];
      logger.info({ conditionId }, 'Stored AI reasoning in Supabase');
    }

    return result;
  } catch (error) {
    logger.error({ 
      error: error.message,
      errorCode: error.code,
      errorDetails: error.details,
      errorHint: error.hint,
      conditionId,
      questionPreview: question?.substring(0, 50) + (question?.length > 50 ? '...' : ''),
      answer,
      reasoningPreview: reasoning?.substring(0, 100) + (reasoning?.length > 100 ? '...' : '')
    }, 'Failed to store AI reasoning in Supabase');
    return null;
  }
}

/**
 * Retrieves AI reasoning for a market condition from Supabase
 * @param {string} conditionId - The ID of the market condition
 * @returns {Promise<Object|null>} - The stored reasoning or null if not found
 */
export async function getAIReasoning(conditionId) {
  try {
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      logger.warn('Supabase configuration is missing. Cannot retrieve AI reasoning.');
      return null;
    }

    const { data, error } = await supabase
      .from(config.SUPABASE_TABLE_NAME)
      .select('*')
      .eq('condition_id', conditionId)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    logger.error({ error: error.message, conditionId }, 'Failed to retrieve AI reasoning from Supabase');
    return null;
  }
}
