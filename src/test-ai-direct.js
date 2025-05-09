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

// System prompt for the AI
const systemPrompt = `You are an expert analyst with real-time access to live news information across the world.
You are tasked with settling prediction markets.
Prediction market data : { "question" : <SAMPLE_QUESTION>, "outcomes" : ["string","string"]} is given to you.
 Analyze the given question and provide a response in the following JSON format:
{
    "answer": "your direct answer here",
    "reasoning": "your detailed analysis and reasoning here referring to REAL-TIME UP-TO DATE INFORMATION"
}
Ensure the response is valid JSON.
"answer" string should be strictly one of the outcomes.
The market question being passed to you refers to a question or event that has
passed / occured till the time you are analyzing this.`;

// Sample market questions to test with
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

// Mock of the actual getMarketSettlementAnalysis function
async function getMarketSettlementAnalysis(marketQuestion, outcomes = ["YES", "NO"]) {
  try {
    console.log(`Processing question: "${marketQuestion}"`);
    console.log(`Possible outcomes: ${outcomes.join(', ')}`);
    
    const userMessageContent = JSON.stringify({ question: marketQuestion, outcomes });

    const response = await client.chat.completions.create({
      model: 'sonar-reasoning',
      messages: [
        {
          role: 'system',
          content: systemPrompt.replace('<SAMPLE_QUESTION>', marketQuestion)
        },
        {
          role: 'user',
          content: userMessageContent
        }
      ],
      temperature: 0.7,
    });

    const messageContent = response.choices[0].message.content;
    console.log('\nRaw AI response:');
    console.log('----------------');
    console.log(messageContent);
    console.log('----------------\n');

    try {
      const parsedResponse = JSON.parse(messageContent);
      if (parsedResponse && parsedResponse.answer && parsedResponse.reasoning) {
        if (!outcomes.includes(parsedResponse.answer)) {
          console.warn(`Warning: AI answer "${parsedResponse.answer}" is not among the expected outcomes: ${outcomes.join(', ')}`);
        }
        return parsedResponse;
      } else {
        console.error('Error: AI response missing required fields (answer/reasoning).');
        return null;
      }
    } catch (parseError) {
      console.error('Error parsing JSON response from AI:', parseError);
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
  console.log('🤖 Direct Perplexity AI Test Script');
  console.log('=================================');
  
  try {
    const questionToTest = customQuestion || testQuestions[selectedQuestion];
    console.log(`\nTesting question: "${questionToTest}"`);
    
    const startTime = Date.now();
    const result = await getMarketSettlementAnalysis(questionToTest, ["YES", "NO"]);
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