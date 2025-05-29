import { createClient } from '@supabase/supabase-js';
import config from './src/config.js';

async function checkMarket(conditionId) {
  try {
    console.log(`🔍 Checking database for condition ID: ${conditionId}`);
    
    // Initialize Supabase client
    const supabase = createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY,
      { auth: { persistSession: false } }
    );

    // Query the database
    const { data, error } = await supabase
      .from('market_ai_reasoning')
      .select('*')
      .eq('condition_id', conditionId);

    if (error) throw error;
    
    if (data && data.length > 0) {
      console.log('✅ Found market in database:');
      console.log(JSON.stringify(data[0], null, 2));
    } else {
      console.log('ℹ️ No record found for this condition ID');
      console.log('This could be because:');
      console.log('1. The market is still being processed');
      console.log('2. There was an error processing the market');
      console.log('3. The market has not been settled yet');
    }
    
  } catch (error) {
    console.error('❌ Error checking market:');
    console.error(error.message);
  }
}

// Get condition ID from command line argument or use the one from the logs
const conditionId = process.argv[2] || '0x776f777f409ea43986415ccfbd3bb26068b5c27e15cd19b316cec09a8324eb22';
checkMarket(conditionId);
