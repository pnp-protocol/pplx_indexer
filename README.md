# EVM Market Indexer

Node.js script to listen for `PNP_MarketCreated` events from an EVM smart contract, store market details in a local SQLite database, and process markets for settlement after their end time plus a configurable delay.

## Prerequisites

- Node.js (v18+ recommended)
- npm

## Setup

1.  **Clone the repository (if applicable)**

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**
    Copy `.env.example` to `.env` and fill in the required values:
    ```bash
    cp .env.example .env
    ```
    Edit `.env` with your details (Private Key, RPC URL, Contract Address).

## Running the Script

-   **Development Mode (with pretty logging):**
    ```bash
    npm run dev
    ```

-   **Production Mode:**
    ```bash
    npm start
    ```

## Project Structure

```
.
├── .env                 # Environment variables (PRIVATE_KEY, RPC_URL, etc.)
├── .env.example         # Example environment variables
├── .gitignore           # Git ignore file
├── package.json         # Project dependencies and scripts
├── README.md            # This file
├── src/
│   ├── index.js         # Main script entry point
│   ├── config.js        # Loads and validates environment variables
│   ├── services/
│   │   ├── blockchain.js # Handles EVM interactions
│   │   └── database.js   # Handles local database (SQLite)
│   ├── jobs/
│   │   └── marketProcessor.js # Logic for checking and processing markets
│   ├── utils/
│   │   └── logger.js     # Logging utility
│   └── abi/
│       └── PNPFactory.json # Contract ABI
└── market_data.sqlite   # SQLite database file (created automatically)
```

## Production Deployment

For production, it's recommended to use a process manager like PM2 to ensure the script runs continuously, manages logs, and restarts on crashes.

Example PM2 start:
```bash
pm2 start src/index.js --name evm-market-indexer
```

These standalone nodejs scripts are responsible for settling markets after
they're done trading.

Uses latest models by Perplexity for it's access to real-time information.
This real-time access to information helps the LLM to correctfully analyze
all relevant data to a market and then settle it.



v1 :
-> Indexes all `event PNP_InitSettlementPPLX(bytes32 indexed conditionId` events.
-> `initSettlement_PPLXMarkets` function is called by third party for now.
-> This event triggers the script to call perplexity API and posts an inference request to settle the market.


v2 :
-> `initSettlement_PPLXMarkets()` removed
-> Script indexes all `PNP_PPLXMarketCreated` events, 
   calls `getMarketEndTime` and stores ( conditionId, endTime ) in the storage.
-> Calls `settleMarket` function with conditionId and endTime from the storage corresponding to expired markets.



