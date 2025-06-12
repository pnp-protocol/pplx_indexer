import OpenAI from 'openai';
import config from '../config.js';
import logger from '../utils/logger.js';
import { storeAIReasoning, storeAIResolution } from './supabaseService.js';

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
passed / occured till the time you are analyzing this.

IMPORTANT: If the question is ambiguous, unclear, unanswerable, or you cannot determine a definitive answer based on available information, you MUST set the "answer" field to null (without quotes) and explain in the "reasoning" field why the question cannot be answered definitively. For example:
{
    "answer": null,
    "reasoning": "The question is ambiguous because [specific reason]. Without clearer criteria or more specific information, a definitive answer cannot be determined."
}`;

const resolutionSystemPrompt = `You are an expert analyst tasked with evaluating the resolvability of a prediction market question and defining how it can be settled objectively, encouraging creative and speculative questions. You will be given a market question and its end time in ISO format. Your task is to:

1. Determine if the question is well-posed, unambiguous, and resolvable by an AI at the specified end time, assuming the event could occur. Focus strictly on whether a definitive, objective outcome (e.g., yes/no for binary markets, a specific value for scalar markets) can be verified using reliable, publicly accessible sources, regardless of the event's current likelihood or feasibility.
2. Define the specific criteria or conditions for settling the question, including what constitutes a definitive outcome (e.g., what qualifies as 'yes' or 'no' for binary markets, or the measurable metric for scalar markets).
3. Identify any ambiguities or challenges in resolving the question and suggest improvements to make it clearer, if applicable.

Provide a response in the following JSON format:
{
    "resolvable": boolean,
    "reasoning": "Explain why the question is or is not resolvable by the end time. Focus on whether a clear, objective outcome can be verified using reliable sources, not on the likelihood of the event occurring. If not resolvable, identify specific ambiguities or lack of verifiable sources and explain why they prevent resolution.",
    "settlement_criteria": "START WITH A BRIEF COMMENTARY ON WHAT THIS QUESTION IS ASKING ABOUT (e.g., 'This question asks about the potential appearance of a celebrity in a video game commercial...'). THEN describe the specific conditions, metrics, or events that must occur to settle the question definitively (e.g., 'An official U.S. government announcement confirming the event', 'A recorded measurement from a specific weather station'). Specify the outcome format (e.g., binary: yes/no, scalar: numerical value).",
    "resolution_sources": ["List specific, reliable, and publicly accessible data sources to verify the outcome at the market's end time (e.g., 'Official U.S. government press releases', 'NASA's official website', 'NOAA API for weather data'). Avoid vague sources like 'news reports' unless a specific outlet or account is named."],
    "suggested_improvements": "If the question is ambiguous or difficult to resolve, provide actionable suggestions to rephrase or clarify it (e.g., 'Specify the exact location for weather-related questions', 'Define the criteria for the event'). If no improvements are needed, state 'None'."
}

Ensure the response is a valid JSON object. Do not assess the likelihood or feasibility of the event occurring. Assume the event is possible and evaluate only whether a definitive outcome can be objectively verified at the end time using reliable sources. The same AI system will use the provided sources and criteria to settle the market later.`;


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
      
      if (parsedResponse && parsedResponse.reasoning) {
        // Case 1: AI explicitly returned null for ambiguous/unanswerable questions
        if (parsedResponse.answer === null) {
          logger.warn({ 
            parsedResponse, 
            marketQuestion,
            conditionId 
          }, 'AI determined the question is ambiguous or unanswerable. Auto-settling as NO.');
          
          // Console log for visibility
          console.log('\n⚠️  AMBIGUOUS QUESTION DETECTED ⚠️');
          console.log(`Market Question: ${marketQuestion}`);
          console.log(`Condition ID: ${conditionId}`);
          console.log(`AI Reasoning: ${parsedResponse.reasoning}`);
          console.log('🔄 Auto-settling as "NO" due to ambiguity');
          console.log('----------------------------------------\n');
          
          // Create modified response with "NO" answer but preserve original reasoning
          const modifiedResponse = {
            answer: "NO",
            reasoning: `[AUTO-SETTLED AS NO] Original AI Assessment: ${parsedResponse.reasoning}`
          };
          
          // Store the reasoning in Supabase with "NO" as answer
          if (conditionId) {
            try {
              await storeAIReasoning(
                conditionId,
                marketQuestion,
                'NO',
                modifiedResponse.reasoning,
                marketCreationTime,
                settlementTime
              );
              logger.info({ conditionId }, 'Successfully stored ambiguous question reasoning in Supabase');
            } catch (supabaseError) {
              logger.error({ 
                err: supabaseError, 
                conditionId, 
                marketQuestion: marketQuestion.substring(0, 50) + '...',
                reasoning: modifiedResponse.reasoning.substring(0, 100) + '...'
              }, 'Failed to store ambiguous question reasoning in Supabase');
            }
          }
          
          return modifiedResponse; // Return "NO" answer to proceed with settlement
        }
        
        // Case 2: AI provided an answer but it's not in the expected outcomes
        if (parsedResponse.answer && !outcomes.includes(parsedResponse.answer)) {
          logger.error({ 
            parsedResponse, 
            outcomes, 
            marketQuestion,
            conditionId 
          }, 'AI answer is not among the expected outcomes. Cannot proceed with settlement.');
          return null;
        }
        
        // Case 3: Valid answer provided - proceed with settlement
        if (parsedResponse.answer) {
          // Store the reasoning in Supabase
          if (conditionId) {
            try {
              await storeAIReasoning(
                conditionId,
                marketQuestion,
                parsedResponse.answer,
                parsedResponse.reasoning,
                marketCreationTime,
                settlementTime
              );
              logger.info({ conditionId }, 'Successfully stored AI reasoning in Supabase');
            } catch (supabaseError) {
              logger.error({ 
                err: supabaseError, 
                conditionId, 
                marketQuestion: marketQuestion.substring(0, 50) + '...',
                answer: parsedResponse.answer
              }, 'Failed to store AI reasoning in Supabase');
            }
          } else {
            logger.warn('No conditionId provided, skipping Supabase storage');
          }
          
          return parsedResponse;
        }
      }
      
      // If we reach here, the response is invalid
      logger.error({ parsedResponse }, 'AI response missing required fields or invalid format.');
      return null;
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

export async function getMarketResolution(marketQuestion, marketEndTime, conditionId) {
  const endTimeISO = new Date(marketEndTime * 1000).toISOString();
  const userMessageContent = JSON.stringify({
    question: marketQuestion,
    endTime: endTimeISO,
  });

  logger.info({ marketQuestion, endTimeISO }, 'Sending request to Perplexity AI for market resolution analysis.');

  try {
    const response = await client.chat.completions.create({
      model: 'sonar',
      messages: [
        {
          role: 'system',
          content: resolutionSystemPrompt,
        },
        {
          role: 'user',
          content: userMessageContent,
        },
      ],
      temperature: 0.2,
    });

    const messageContent = response.choices[0].message.content;
    logger.info({ response: messageContent }, 'Received market resolution analysis from Perplexity AI.');

    if (messageContent) {
      const parsedResponse = parseAIResponse(messageContent);
      if (parsedResponse) {
        console.log('\\n✅ MARKET RESOLUTION ANALYSIS ✅');
        console.log(`Market Question: ${marketQuestion}`);
        console.log(`Resolvable: ${parsedResponse.resolvable}`);
        console.log(`Reasoning: ${parsedResponse.reasoning}`);
        console.log(`Settlement Criteria: ${parsedResponse.settlement_criteria}`);
        console.log(`Resolution Sources: ${JSON.stringify(parsedResponse.resolution_sources, null, 2)}`);
        console.log(`Suggested Improvements: ${parsedResponse.suggested_improvements}`);
        console.log('----------------------------------------\\n');

        // Store the result in Supabase using the new function
        if (conditionId) {
          await storeAIResolution(
            conditionId,
            marketQuestion,
            parsedResponse
          );
        } else {
          logger.warn('No conditionId provided to getMarketResolution, skipping Supabase storage.');
        }

        return parsedResponse;
      }
    }
    return null;
  } catch (error) {
    logger.error({ err: error, 'function': 'getMarketResolution' }, 'Error calling Perplexity AI API');
    if (error.response) {
      logger.error('Error details from AI API:', error.response.data);
    }
    return null;
  }
} 