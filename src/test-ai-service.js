import { getMarketSettlementAnalysis } from './services/aiService.js';
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
} else {
  console.error('No .env file found. Please make sure your PPLX_API_KEY is set in the environment.');
}

// Check if API key is available
if (!process.env.PPLX_API_KEY) {
  console.error('PPLX_API_KEY is not set. Please set it in your .env file or as an environment variable.');
  process.exit(1);
}

// Sample market questions to test with
const testQuestions = [
    "Will Tesla stock trade above $250 dollars after 8 May 2025?"
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

// Main function
async function testAiService() {
  console.log('🤖 AI Service Test Script');
  console.log('=========================');
  
  try {
    const questionToTest = customQuestion || testQuestions[selectedQuestion];
    console.log(`Testing question: "${questionToTest}"`);
    console.log('Sending request to Perplexity AI...');
    
    const startTime = Date.now();
    const result = await getMarketSettlementAnalysis(questionToTest, ["YES", "NO"]);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n✅ Response received in ${duration} seconds:\n`);
    
    if (result) {
      console.log(`Answer: ${result.answer}`);
      console.log('\nReasoning:');
      console.log(result.reasoning);
    } else {
      console.error('❌ Error: Failed to get a valid response from the AI service');
    }
  } catch (error) {
    console.error('❌ Error testing AI service:', error);
  }
}

// Run the test
testAiService().catch(console.error); 