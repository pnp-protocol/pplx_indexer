import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try to load env vars from .env file
const possiblePaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env'),
];

let envPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    envPath = p;
    break;
  }
}

if (envPath) {
  console.log(`Loading .env file from: ${envPath}`);
  dotenv.config({ path: envPath });
}

// Get API Key from environment or allow direct input
let apiKey = process.env.PPLX_API_KEY;
if (!apiKey) {
  // You can hardcode your API key here for testing purposes ONLY
  // apiKey = "YOUR_PPLX_API_KEY_HERE";
  
  console.error('PPLX_API_KEY is not set. Please set it in your .env file or uncomment and set it directly in this file.');
  process.exit(1);
}

// Initialize OpenAI client
const client = new OpenAI({
  apiKey: apiKey,
  baseURL: 'https://api.perplexity.ai',
});

// System prompt with STRONGER emphasis on valid JSON
const systemPrompt = `You are an expert analyst with real-time access to live news information.
You are tasked with settling prediction markets by answering questions with a simple YES or NO.

EXTREMELY IMPORTANT: You MUST respond in valid JSON format with this exact structure:
{
    "answer": "YES or NO only",
    "reasoning": "your detailed analysis here"
}

Your response MUST be proper parseable JSON without any formatting, markdown, or additional text.
The "answer" field MUST be EXACTLY "YES" or "NO" - nothing else.
The market question being passed to you refers to an event that has already occurred.`;

// Sample test questions
const testQuestions = [
  "Will Donald Trump win the 2024 US Presidential Election?",
  "Will Bitcoin price be above $100,000 USD by the end of 2024?",
  "Will SpaceX successfully conduct an orbital launch of Starship by the end of 2023?",
  "Will an AI system win a gold medal at the International Mathematical Olympiad by 2025?",
  "Will ChatGPT have more than 1 billion monthly active users by the end of 2025?"
];

// Parse command line arguments
const args = process.argv.slice(2);
let customQuestion = null;
let selectedQuestion = 0;

if (args.length > 0) {
  // Check if it's a number to select from test questions
  if (/^\d+$/.test(args[0]) && parseInt(args[0]) < testQuestions.length) {
    selectedQuestion = parseInt(args[0]);
  } else {
    // Otherwise treat it as a custom question
    customQuestion = args[0];
  }
}

/**
 * Attempt to fix malformed JSON if parsing fails
 * @param {string} jsonString - The potentially malformed JSON string
 * @returns {object|null} - Parsed JSON object or null if unfixable
 */
function attemptToFixJson(jsonString) {
  try {
    // First try direct parsing
    return JSON.parse(jsonString);
  } catch (e) {
    console.log('Direct JSON parsing failed, attempting to fix...');
    
    // Common issues to fix:
    
    // 1. Strip any markdown code block markers
    let fixed = jsonString.replace(/```json/g, '').replace(/```/g, '');
    
    // 2. Try to find JSON object boundaries { ... }
    const jsonMatch = fixed.match(/{[\s\S]*}/);
    if (jsonMatch) {
      fixed = jsonMatch[0];
      console.log('Extracted JSON object:', fixed);
    }
    
    // 3. Fix escaped quotes within strings
    fixed = fixed.replace(/\\"/g, '"').replace(/"{/g, '{').replace(/}"/g, '}');
    
    // 4. Fix unescaped quotes within strings
    // This is a simplistic approach, would need more complex parsing for robust handling
    
    // Try parsing the fixed string
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      console.error('Failed to fix JSON:', e2.message);
      console.log('Original string:', jsonString);
      console.log('After attempted fix:', fixed);
      return null;
    }
  }
}

async function testAiWithJsonValidation(marketQuestion, outcomes = ["YES", "NO"]) {
  try {
    console.log(`Processing question: "${marketQuestion}"`);
    console.log(`Possible outcomes: ${outcomes.join(', ')}`);
    
    // With response_format to force JSON
    const response = await client.chat.completions.create({
      model: 'sonar-reasoning',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: `Please analyze this prediction market question and provide a YES/NO answer with reasoning: "${marketQuestion}"`
        }
      ],
      temperature: 0.3, // Lower temperature for more deterministic output
      response_format: { type: "json_object" } // Force JSON response if the model supports it
    });

    const messageContent = response.choices[0].message.content;
    console.log('\nRaw AI response:');
    console.log('----------------');
    console.log(messageContent);
    console.log('----------------\n');

    // Try to parse the response
    let parsedResponse = null;
    
    try {
      parsedResponse = JSON.parse(messageContent);
    } catch (parseError) {
      console.log('Standard JSON parsing failed:', parseError.message);
      // Try to fix and parse the response
      parsedResponse = attemptToFixJson(messageContent);
    }
    
    if (parsedResponse && parsedResponse.answer && parsedResponse.reasoning) {
      // Normalize the answer to ensure it's one of the expected outcomes
      const normalizedAnswer = parsedResponse.answer.trim().toUpperCase();
      
      if (!outcomes.includes(normalizedAnswer)) {
        console.warn(`Warning: AI answer "${parsedResponse.answer}" is not among the expected outcomes.`);
        console.warn(`Attempting to normalize to one of: ${outcomes.join(', ')}`);
        
        // Try to map the answer to one of the expected outcomes
        if (outcomes.includes("YES") && ["Y", "YES", "TRUE", "CORRECT", "RIGHT"].includes(normalizedAnswer)) {
          parsedResponse.answer = "YES";
        } else if (outcomes.includes("NO") && ["N", "NO", "FALSE", "INCORRECT", "WRONG"].includes(normalizedAnswer)) {
          parsedResponse.answer = "NO";
        } else {
          console.error(`Cannot normalize answer "${parsedResponse.answer}" to expected outcomes.`);
        }
      }
      
      return parsedResponse;
    } else {
      console.error('Error: AI response missing required fields or parsing failed');
      return null;
    }
  } catch (error) {
    console.error('Error calling Perplexity API:', error.message);
    if (error.response) {
      console.error('API Error details:', error.response.data);
    }
    return null;
  }
}

// Main function
async function runTest() {
  console.log('🤖 AI JSON Fix Test Script');
  console.log('=========================');
  
  try {
    const questionToTest = customQuestion || testQuestions[selectedQuestion];
    console.log(`\nTesting question: "${questionToTest}"`);
    
    const startTime = Date.now();
    const result = await testAiWithJsonValidation(questionToTest, ["YES", "NO"]);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n✅ Response processed in ${duration} seconds\n`);
    
    if (result) {
      console.log(`Final Answer: ${result.answer}`);
      console.log('\nReasoning:');
      console.log(result.reasoning);
    }
  } catch (error) {
    console.error('❌ Error in test:', error);
  }
}

// Run the test
runTest().catch(console.error); 