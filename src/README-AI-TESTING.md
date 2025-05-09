# AI Service Testing Tools

This directory contains several scripts to test the AI service used for market settlement independently from the main application.

## Prerequisites

1. Make sure you have a Perplexity API key
2. Either:
   - Set it in your `.env` file as `PPLX_API_KEY=your_key_here`
   - Or modify the scripts directly to include your key (for testing only)

## Available Test Scripts

### 1. Basic Module Test (`test-ai-service.js`)

Tests the AI service module directly:

```bash
node src/test-ai-service.js [question_index_or_custom_question]
```

Example:
```bash
# Test with sample question #2
node src/test-ai-service.js 2

# Test with a custom question
node src/test-ai-service.js "Will Ethereum merge to proof of stake in 2022?"
```

### 2. Direct API Test (`test-ai-direct.js`)

Tests the Perplexity API directly with a simplified implementation:

```bash
node src/test-ai-direct.js [question_index_or_custom_question]
```

### 3. JSON Fix Test (`test-ai-json-fix.js`)

Tests with enhanced JSON handling and validation to resolve parsing errors:

```bash
node src/test-ai-json-fix.js [question_index_or_custom_question]
```

This script includes:
- Forced JSON response format
- JSON parsing error recovery
- Answer normalization
- Lower temperature for more consistent responses

## Troubleshooting

If you're experiencing JSON parsing errors in the main application, try these steps:

1. Run the JSON Fix test script with your problematic question:
   ```bash
   node src/test-ai-json-fix.js "Your problematic question here"
   ```

2. Review the raw response to identify issues with the JSON format

3. If successful, consider updating the main aiService.js to include similar fixes:
   - Add response_format parameter
   - Add JSON fixing function
   - Reduce temperature
   - Update the system prompt to emphasize valid JSON

## Resetting Failed Markets

If you have markets that failed processing due to AI errors, you can reset them using:

```bash
node src/index.js reset-market <conditionId>
```

This will:
1. Reset the market's processed status
2. Reset the retry count
3. Allow the market to be processed again in the next cycle 