// this script accepts conditionId via an endpoint
// gets string question from smart contract via 
// gets marketOutcomes : YES and NO basically
// generates answer field
// pushes to settleMarket

import { ethers } from 'ethers';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const port = process.env.PORT;
const apiKey = process.env.PPLX_API_KEY;
const privateKey = process.env.PRIVATE_KEY; 
const rpcUrl = process.env.RPC_URL; 


// .env requirements
try {
    if (!port) throw new Error("PORT is not defined in .env");
    if (!apiKey) throw new Error("PPLX_API_KEY is not defined in .env");
    if (!privateKey) throw new Error("PRIVATE_KEY is not defined in .env");
    if (!rpcUrl) throw new Error("RPC_URL is not defined in .env");
} catch (error) {
    console.error(error);
    process.exit(1);
}


const client = new OpenAI({
    apiKey: apiKey, // Replace with your Perplexity API key
    baseURL: 'https://api.perplexity.ai',  // Perplexity API endpoint
  });

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

const contractABI = [
    "function marketQuestion(bytes32 conditionId) external view returns (string memory)",
    "function settleMarket(bytes32 conditionId, uint256 _winningTokenId) external returns (uint256)",
    "function getYesTokenId(bytes32 conditionId) external pure returns (uint256)",
    "function getNoTokenId(bytes32 conditionId) external pure returns (uint256)"
];

const contractAddress = "0xYourContractAddress"; 
// Create contract instance
const contract = new ethers.Contract(contractAddress, contractABI, wallet);

// returns {question, outcomes} object
async function getMarketData(conditionId) {
    try {
        // Read from contract (view functions)
        const question = await contract.getQuestion(conditionId);
        console.log(`market question corresponding to ${conditionId} is:`);
        console.log(`Question: ${question}`);        
        return { question: question, outcomes: ["YES", "NO"] };
    } catch (error) {
        console.error('Error fetching market data:', error);
        throw error;
    }
}

async function settleMarket(conditionId, answer) {
    try {
        // Write to contract (transaction)
        const tx = await contract.settleMarket(conditionId, answer);
        console.log('Transaction sent:', tx.hash);
        
        // Wait for transaction to be mined
        const receipt = await tx.wait();
        console.log('Transaction confirmed in block:', receipt.blockNumber);
        
        return receipt;
    } catch (error) {
        console.error('Error settling market:', error);
        throw error;
    }
}

async function getYesTokenId(conditionId) {
    try {
        const tokenId = await contract.getYesTokenId(conditionId);
        console.log(`YES Token Id corresponding to ${conditionId} : ${tokenId}`);
        return tokenId;
    }
    catch(error){
        console.error('Error getting tokenId:', error);
        throw error;
    }

}

async function getNoTokenId(conditionId){
    try {
        const tokenId = await contract.getNoTokenId(conditionId);
        console.log(`NO Token Id corresponding to ${conditionId} : ${tokenId}`);
        return tokenId;
    }
    catch(error){
        console.error('Error getting tokenId:', error);
        throw error;
    }
}


// returns the json object
// answer, reasoning
// construct winningTokenId from the "answer" field
async function askQuestion(question) {

    try {
        const systemPrompt = `You are an expert analyst with real-time access to live news information across the world.
        You are tasked with settling prediction markets.
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
       

        const response = await client.chat.completions.create({
            model: 'sonar-reasoning',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: question
                }
            ],
            temperature: 0.7
        });
        console.log("Response:", response.choices[0].message.content);
    } catch (error) {
        console.error('Error:', error);
        if (error.response) {
            console.error('Error details:', error.response.data);
        }
    }
}

async function processMarket(conditionId) {
    try {
        // 1. Get market data from contract
        const { question, outcomes } = await getMarketData(conditionId);
        console.log('Market data:', { question, outcomes });

        // 2. Get AI analysis
        const { answer, reasoning } = await askQuestion(question, outcomes);
        console.log('AI analysis:', { answer, reasoning });

        // 3. Settle market with the answer
        const receipt = await settleMarket(conditionId, answer);
        console.log('Market settled:', receipt);

        return { success: true, answer, reasoning, transactionHash: receipt.transactionHash };
    } catch (error) {
        console.error('Error processing condition:', error);
        return { success: false, error: error.message };
    }     
}


// try functions separately
// askQuestion("Who will win the third match between RCB and CSK in IPL 2025?");


