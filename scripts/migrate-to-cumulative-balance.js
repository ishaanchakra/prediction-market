// scripts/migrate-to-cumulative-balance.js
// Migrate user documents from weekly-reset model to cumulative balance model.
//
// Transforms:
//   weeklyRep → balance (copy current value)
//   weeklyStartingBalance → REMOVE
//   + totalDeposits: 1000
//   + accountCreatedAt: user.createdAt (existing field)
//   + lastStipendWeek: null
//
// Run with:
//   node scripts/migrate-to-cumulative-balance.js
//   node scripts/migrate-to-cumulative-balance.js --dry-run

const admin = require('firebase-admin');

const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const isDryRun = process.argv.includes('--dry-run');

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

async function main() {
  console.log('PredictCornell - Migrate to Cumulative Balance Model');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('---');

  const usersSnapshot = await db.collection('users').get();
  const users = usersSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  console.log(`Total users: ${users.length}`);

  let migratedCount = 0;
  let alreadyMigratedCount = 0;
  const operations = [];

  for (const user of users) {
    // Skip users that already have the new `balance` field
    if (user.balance !== undefined) {
      alreadyMigratedCount += 1;
      continue;
    }

    const currentBalance = round2(Number(user.weeklyRep || 1000));
    const accountCreatedAt = user.createdAt || new Date();

    const update = {
      balance: currentBalance,
      totalDeposits: 1000,
      accountCreatedAt,
      lastStipendWeek: null
    };

    const fieldsToDelete = {};
    if (user.weeklyRep !== undefined) {
      fieldsToDelete.weeklyRep = admin.firestore.FieldValue.delete();
    }
    if (user.weeklyStartingBalance !== undefined) {
      fieldsToDelete.weeklyStartingBalance = admin.firestore.FieldValue.delete();
    }

    operations.push({
      id: user.id,
      update: { ...update, ...fieldsToDelete },
      currentBalance
    });
    migratedCount += 1;
  }

  console.log(`To migrate: ${migratedCount}`);
  console.log(`Already migrated: ${alreadyMigratedCount}`);

  if (isDryRun) {
    console.log('\nDry run — no writes performed.');
    for (const op of operations.slice(0, 10)) {
      console.log(`  ${op.id}: weeklyRep → balance = ${op.currentBalance}`);
    }
    if (operations.length > 10) {
      console.log(`  ... and ${operations.length - 10} more`);
    }
    return;
  }

  if (operations.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  const chunks = chunkArray(operations, 400);
  let written = 0;

  for (const chunk of chunks) {
    const batch = db.batch();
    for (const op of chunk) {
      const ref = db.collection('users').doc(op.id);
      batch.update(ref, op.update);
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  Committed batch: ${written}/${operations.length}`);
  }

  await db.collection('adminLog').add({
    action: 'MIGRATE_CUMULATIVE_BALANCE',
    detail: `Migrated ${written} users from weeklyRep to balance model.`,
    actor: 'script',
    timestamp: new Date()
  });

  console.log(`\nDone. Migrated ${written} users.`);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
