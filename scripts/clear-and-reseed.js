// Clears all existing knowledge base entries and reseeds with the full framework + SSI client
require('dotenv').config();
var { createClient } = require('@supabase/supabase-js');

var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function clearAll() {
  console.log('Clearing existing knowledge base entries...');

  // Delete all rows (Supabase needs a filter, use gte on created_at to match all)
  var result = await supabase
    .from('knowledge_base')
    .delete()
    .gte('created_at', '2000-01-01');

  if (result.error) {
    console.error('Failed to clear:', result.error.message);
    return false;
  }

  console.log('Cleared all existing entries.\n');
  return true;
}

clearAll().then(function(success) {
  if (success) {
    console.log('Now run the seed scripts:');
    console.log('  node scripts/seed-frameworks.js');
    console.log('  node scripts/seed-client-ssi.js');
  }
});
