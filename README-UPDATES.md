# Market Indexer Updates

## Recent Improvements

### 1. Enhanced UI & Logging

We've improved the user interface of the console output with:
- Pretty-printed logs with better formatting and colors
- Emoji indicators for market status (🟢 active, 🔴 ended)
- Human-readable timestamps
- Clear visual separation between markets
- ✅/❌ indicators for processed status

### 2. BigInt Token ID Handling

Fixed handling of large token IDs from the smart contract:
- Token IDs are now stored as TEXT in the database (previously INTEGER)
- No more precision loss when handling very large numbers
- Contract calls for `getYesTokenId` and `getNoTokenId` are properly awaited
- Condensed display format for very long token IDs

### 3. Clear Settlement Results

When a market is settled, you'll see:
```
🎯 MARKET SETTLEMENT SUCCESSFUL 🎯
ConditionID: 0x7f0da668712545d87062dfb72f9315139a8a4f075e338614b0a33c3d2839d39a
Winner: YES token (ID: 75038937214453257951707310162415557690506111329639382421063369530913061231998)
------------------------------------
```

## How It Works

1. The script fetches market data from the blockchain
2. For markets with ended times + delay buffer, it:
   - Sends the market question to Perplexity AI
   - Gets a YES/NO answer plus reasoning
   - Retrieves the corresponding token ID from the smart contract
   - Stores this token ID in the database
   - Displays the result with user-friendly formatting

## Required Configuration

Make sure your .env file includes:
- `PPLX_API_KEY` - Your Perplexity API key
- `LOG_LEVEL` - Set to "info" for normal operation
- `LOG_FILE_PATH` - Path for log files (optional)

## Commands

- Start the indexer: `npm start`
- Reset a failed market: `npm start reset-market <conditionId>` 