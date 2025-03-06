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



