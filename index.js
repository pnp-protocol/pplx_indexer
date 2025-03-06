// libs to use
// ethers 
// dotenv
// no server just script

import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const port = process.env.PORT;
const apiKey = process.env.PPLX_API_KEY;


try {
    if (!port) {
        throw new Error("Environment variable PORT is not defined in the .env file.");
    }

    if (!apiKey) {
        throw new Error("Environment variable PPLX_API_KEY is not defined in the .env file.");
    }
} catch (error) {
    console.error(error);
    process.exit(1);
}

const client = new OpenAI({
    apiKey: apiKey, // Replace with your Perplexity API key
    baseURL: 'https://api.perplexity.ai',  // Perplexity API endpoint
  });

async function askQuestion(question) {
    try {
        const systemPrompt = `You are an expert analyst focused on cryptocurrency, tech industry, and political events. 
        Analyze the given question and provide a response in the following JSON format:
        {
            "answer": "your direct answer here",
            "reasoning": "your detailed analysis and reasoning here"
        }
        Ensure the response is valid JSON.`;

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

askQuestion("Will Elon Musk be present in the White House Crypto Summit on 7 March 2025 Friday?");
