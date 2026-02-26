// scripts/backfill-weekly-starting-balance.js
// Run: node scripts/backfill-weekly-starting-balance.js
// Run (dry): node scripts/backfill-weekly-starting-balance.js --dry-run

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function parseArgs(argv) {
  return { dryRun: argv.includes('--dry-run') };
}

function ensureServiceAccount() {
  const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: serviceAccountKey.json not found.');
    process.exit(1);
  }
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

async function run() {
  const { dryRun } = parseArgs(process.argv);
  ensureServiceAccount();
  const db = admin.firestore();

  console.log('PredictCornell - Backfill weeklyStartingBalance');
  if (dryRun) console.log('Mode: DRY RUN - no writes will be made\n');

  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const toBackfill = users.filter((u) => u.weeklyStartingBalance == null);
  const alreadySet = users.length - toBackfill.length;

  console.log(`Total users: ${users.length}`);
  console.log(`Already have weeklyStartingBalance: ${alreadySet}`);
  console.log(`Need backfill: ${toBackfill.length}\n`);

  if (toBackfill.length === 0) {
    console.log('Nothing to do. All users already have weeklyStartingBalance set.');
    process.exit(0);
  }

  toBackfill.forEach((u) => {
    const balance = round2(Number(u.weeklyRep || 1000));
    console.log(`  ${u.id}: weeklyRep=${balance} -> weeklyStartingBalance=${balance}`);
  });

  if (dryRun) {
    console.log('\nDRY RUN complete. No writes made.');
    process.exit(0);
  }

  console.log('\nType "BACKFILL" to confirm writes: ');
  const input = await new Promise((resolve) => process.stdin.once('data', (d) => resolve(d.toString().trim())));
  if (input !== 'BACKFILL') {
    console.log('Cancelled.');
    process.exit(0);
  }

  const chunks = chunkArray(toBackfill, 400);
  let written = 0;
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((u) => {
      const balance = round2(Number(u.weeklyRep || 1000));
      batch.update(db.collection('users').doc(u.id), {
        weeklyStartingBalance: balance
      });
    });
    await batch.commit();
    written += chunk.length;
    console.log(`Wrote ${written}/${toBackfill.length}...`);
  }

  await db.collection('adminLog').add({
    action: 'BACKFILL_WEEKLY_STARTING_BALANCE',
    detail: `Set weeklyStartingBalance for ${written} users from their current weeklyRep.`,
    timestamp: new Date()
  });

  console.log(`\nDone. Backfilled ${written} users.`);
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
