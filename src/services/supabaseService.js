import { createClient } from '@supabase/supabase-js';
import config from '../config.js';
import logger from '../utils/logger.js';

// Initialize the Supabase client only if the config is available
let supabase;
if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
} else {
  logger.warn('Supabase URL or Anon Key is not configured. Supabase-related operations will be disabled.');
}

/**
 * Stores AI reasoning for a market settlement in Supabase.
 * @param {string} conditionId - The ID of the market condition.
 * @param {string} question - The market question.
 * @param {string} answer - The AI's answer (YES/NO).
 * @param {string} reasoning - The AI's detailed reasoning.
 * @param {string} [marketCreationTime] - Optional market creation timestamp.
 * @param {string} [settlementTime] - Optional settlement timestamp.
 * @returns {Promise<Object|null>} The inserted or updated record, or null.
 */
export async function storeAIReasoning(conditionId, question, answer, reasoning, marketCreationTime, settlementTime) {
  if (!supabase) return null;

  const tableName = config.SUPABASE_TABLE_NAME;
  if (!tableName) {
    logger.error('SUPABASE_TABLE_NAME not set. Cannot store AI reasoning.');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(tableName)
      .upsert(
        {
          condition_id: conditionId,
          market_question: question,
          ai_answer: answer,
          ai_reasoning: reasoning,
          market_creation_time: marketCreationTime,
          settlement_time: settlementTime,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'condition_id' }
      )
      .select()
      .single();

    if (error) {
      logger.error({ err: error, conditionId, table: tableName }, 'Failed to store AI reasoning in Supabase.');
      // Don't rethrow, as this is a non-critical logging operation.
      return null;
    }

    logger.info({ conditionId, table: tableName }, 'Successfully stored AI settlement reasoning in Supabase.');
    return data;
  } catch (err) {
    logger.error({ err, conditionId }, `Exception while storing AI reasoning in Supabase table ${tableName}`);
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

export async function storeAIResolution(conditionId, question, resolutionData) {
  if (!supabase) return null;

  const tableName = config.SUPABASE_TABLE_NAME_RESOLUTION;
  if (!tableName) {
    logger.error('SUPABASE_TABLE_NAME_RESOLUTION not set. Cannot store AI reasoning.');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(tableName)
      .insert({
        condition_id: conditionId,
        question: question,
        resolvable: resolutionData.resolvable,
        reasoning: resolutionData.reasoning,
        settlement_criteria: resolutionData.settlement_criteria,
        resolution_sources: resolutionData.resolution_sources,
        suggested_improvements: resolutionData.suggested_improvements,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: error, conditionId, table: tableName }, 'Failed to store AI resolution in Supabase.');
      // Don't rethrow, as this is a non-critical logging operation.
      return null;
    }

    logger.info({ conditionId, table: tableName }, 'Successfully stored AI settlement resolution in Supabase.');
    return data;
  } catch (err) {
    logger.error({ err, conditionId }, `Exception while storing AI reasoning in Supabase table ${tableName}`);
    return null;
  }
}
