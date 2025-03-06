// libs to use
// ethers 
// dotenv
// no server just script

const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config();

const port = process.env.PORT ;
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

const jsonSchema = {
    "type": "object",
    "properties": {
      "answer": { "type": "string" },
      "reasoning": { "type": "string" }
    },
    "required": ["answer", "reasoning"]
};

async function askQuestion(question) {
    const url = "https://api.perplexity.ai/chat/completions";
  
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  
    const data = {
      "model": "mistral-7b-instruct",
      "messages": [
        {
          "role": "system",
          "content": "You are a helpful assistant that provides interesting, accurate, and concise facts."
        },
        {
          "role": "user",
          "content": question
        }
      ],
      "response_format" : {
        "type" : "json_schema",
        "json_schema" : jsonSchema
      },
      "temperature": 0.7
    };
  
    try {
      const response = await axios.post(url, data, { headers });
      console.log("Response:", response.data.choices[0].message.content);
    } catch (error) {
      console.error("Error making API request:", error.message);
    }
}

askQuestion("Will Elon Musk be present in the White House Crypto Summit on 7 March 2025 Friday?");




