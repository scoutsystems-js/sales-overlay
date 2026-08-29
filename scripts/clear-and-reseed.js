/**
 * ⚠⚠ THIS DELETES EVERY ROW IN `knowledge_base`. IT IS NOT A SEED SCRIPT.
 *
 * It was written when the table held nothing but seed data. It now holds real,
 * unrecoverable material: 1,625 harvested call moments (the rep's own proven
 * lines, captured from calls they closed), plus user uploads. Running this
 * without thinking destroys everything Scout has learned, and there is no
 * backup of it anywhere.
 *
 * ⚠ SO IT REFUSES BY DEFAULT and requires the row count to be stated back:
 *     node scripts/clear-and-reseed.js --yes-delete-all=<count>
 * Naming the count is the point — it cannot be muscle-memory, and if the number
 * has moved since you read it, the script stops.
 */
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

/* ⚠ THE GUARD. Two things have to be true: an explicit flag, and a count that
   matches what is actually in the table right now. */
async function main() {
  var arg = process.argv.filter(function (a) { return a.indexOf('--yes-delete-all=') === 0; })[0];
  var head = await supabase.from('knowledge_base').select('id', { count: 'exact', head: true });
  if (head.error) {
    console.error('Could not count knowledge_base rows: ' + head.error.message);
    console.error('REFUSING — a destructive op must not run when it cannot see what it would destroy.');
    process.exit(1);
  }
  var live = head.count || 0;

  if (!arg) {
    console.error('REFUSING: this deletes ALL ' + live + ' knowledge_base rows, including harvested call moments.');
    console.error('There is no backup. If you are certain, re-run with:');
    console.error('  node scripts/clear-and-reseed.js --yes-delete-all=' + live);
    process.exit(1);
  }
  var claimed = Number(arg.split('=')[1]);
  if (!isFinite(claimed) || claimed !== live) {
    console.error('REFUSING: you said ' + arg.split('=')[1] + ' rows, but the table holds ' + live + '.');
    console.error('The count is stated back deliberately — a mismatch means the table moved since you looked.');
    process.exit(1);
  }

  var ok = await clearAll();
  if (ok) {
    console.log('Now run the seed scripts:');
    console.log('  node scripts/seed-frameworks.js');
    console.log('  node scripts/seed-knowledge-base.js');
  }
}

main();
