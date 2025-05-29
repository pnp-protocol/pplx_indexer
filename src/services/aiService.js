import OpenAI from 'openai';
import config from '../config.js';
import logger from '../utils/logger.js';
import { storeAIReasoning } from './supabaseService.js';

const client = new OpenAI({
  apiKey: config.PPLX_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

const systemPrompt = `You are an expert analyst with real-time access to information across the world and resources at your bay.
You are tasked with answering the question based on the information available.
Prediction market data : { "question" : <SAMPLE QUESTION>, "outcomes" : ["string","string"]} is given to you.
 Analyze the given question and provide a response in the following JSON format:
{
    "answer": "your direct answer here",
    "reasoning": "your detailed analysis and reasoning here referring to REAL-TIME UP-TO DATE INFORMATION"
}
Ensure the response is valid JSON.
"answer" string should be strictly one of the outcomes.
The market question being passed to you refers to a question or event that has
passed / occured till the time you are analyzing this.`;

/**
 * Cleans and parses the AI response which might be in markdown format
 * @param {string} rawResponse - The raw response from the AI
 * @returns {object|null} - Parsed JSON object or null if parsing fails
 */
function parseAIResponse(rawResponse) {
  // Remove markdown code blocks that may surround the JSON
  const cleanedResponse = rawResponse
    .replace(/^```json\s*\n/g, '') // Remove starting ```json
    .replace(/\n```\s*$/g, '')     // Remove ending ```
    .replace(/^```\s*\n/g, '')     // Remove starting ``` without "json"
    .replace(/\n```\s*$/g, '');    // Remove ending ```
  
  try {
    return JSON.parse(cleanedResponse);
  } catch (error) {
    logger.error({ 
      error: error.message, 
      rawResponse: rawResponse.substring(0, 150) + (rawResponse.length > 150 ? '...' : ''),
      cleanedResponse: cleanedResponse.substring(0, 150) + (cleanedResponse.length > 150 ? '...' : '')
    }, 'Failed to parse cleaned AI response');
    return null;
  }
}

/**
 * Asks Perplexity AI to analyze a market question and provide a settlement answer.
 * @param {string} marketQuestion - The question of the market.
 * @param {string[]} outcomes - An array of possible outcomes, e.g., ["YES", "NO"].
 * @param {string} conditionId - The ID of the market condition.
 * @param {string} [marketCreationTime] - Optional market creation timestamp.
 * @param {string} [settlementTime] - Optional settlement timestamp.
 * @returns {Promise<object|null>} A promise that resolves to an object with "answer" and "reasoning", or null if an error occurs.
 */
export async function getMarketSettlementAnalysis(
  marketQuestion, 
  outcomes = ["YES", "NO"],
  conditionId,
  marketCreationTime,
  settlementTime
) {
  const userMessageContent = JSON.stringify({ question: marketQuestion, outcomes });

  logger.info({ marketQuestion, outcomes }, 'Sending request to Perplexity AI for market settlement analysis.');

  try {
    const response = await client.chat.completions.create({
      model: 'sonar', 
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userMessageContent
        }
      ],
      temperature: 0.7,
    });

    const messageContent = response.choices[0].message.content;
    logger.info({ response: messageContent }, 'Received response from Perplexity AI.');

    if (messageContent) {
      // Parse response with markdown handling
      const parsedResponse = parseAIResponse(messageContent);
      
      if (parsedResponse && parsedResponse.answer && parsedResponse.reasoning) {
        if (!outcomes.includes(parsedResponse.answer)) {
          logger.warn({ parsedResponse, outcomes }, 'AI answer is not among the expected outcomes.');
          // Optionally, you could add logic here to retry or default
        }
        
        // Store the reasoning in Supabase
        if (conditionId) {
          await storeAIReasoning(
            conditionId,
            marketQuestion,
            parsedResponse.answer,
            parsedResponse.reasoning,
            marketCreationTime,
            settlementTime
          );
        } else {
          logger.warn('No conditionId provided, skipping Supabase storage');
        }
        
        return parsedResponse;
      } else {
        logger.error({ parsedResponse }, 'AI response missing required fields (answer/reasoning).');
        return null;
      }
    } else {
      logger.error('Perplexity AI response content is empty.');
      return null;
    }
  } catch (error) {
    logger.error({ err: error }, 'Error calling Perplexity AI API');
    if (error.response) {
      logger.error('Error details from AI API:', error.response.data);
    }
    return null;
  }
} 