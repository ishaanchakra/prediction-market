// scripts/reset-database.js
// Run with: node scripts/reset-database.js

const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('../serviceAccountKey.json'); // You'll need to download this

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Utility function for rounding to 2 decimals
function round2(num) {
  return Math.round(num * 100) / 100;
}

async function resetDatabase() {
  console.log('🔄 Starting database reset...\n');

  try {
    // 1. Delete all markets
    console.log('Deleting all markets...');
    const marketsSnapshot = await db.collection('markets').get();
    const marketsBatch = db.batch();
    marketsSnapshot.docs.forEach(doc => {
      marketsBatch.delete(doc.ref);
    });
    await marketsBatch.commit();
    console.log(`✅ Deleted ${marketsSnapshot.size} markets\n`);

    // 2. Delete all bets
    console.log('Deleting all bets...');
    const betsSnapshot = await db.collection('bets').get();
    const betsBatch = db.batch();
    betsSnapshot.docs.forEach(doc => {
      betsBatch.delete(doc.ref);
    });
    await betsBatch.commit();
    console.log(`✅ Deleted ${betsSnapshot.size} bets\n`);

    // 3. Delete all notifications
    console.log('Deleting all notifications...');
    const notifsSnapshot = await db.collection('notifications').get();
    const notifsBatch = db.batch();
    notifsSnapshot.docs.forEach(doc => {
      notifsBatch.delete(doc.ref);
    });
    await notifsBatch.commit();
    console.log(`✅ Deleted ${notifsSnapshot.size} notifications\n`);

    // 4. Delete all comments
    console.log('Deleting all comments...');
    const commentsSnapshot = await db.collection('comments').get();
    const commentsBatch = db.batch();
    commentsSnapshot.docs.forEach(doc => {
      commentsBatch.delete(doc.ref);
    });
    await commentsBatch.commit();
    console.log(`✅ Deleted ${commentsSnapshot.size} comments\n`);

    // 5. Delete all display name keys
    console.log('Deleting all display name keys...');
    const displayNamesSnapshot = await db.collection('displayNames').get();
    const displayNamesBatch = db.batch();
    displayNamesSnapshot.docs.forEach(doc => {
      displayNamesBatch.delete(doc.ref);
    });
    await displayNamesBatch.commit();
    console.log(`✅ Deleted ${displayNamesSnapshot.size} display name keys\n`);

    // 6. Delete all market requests
    console.log('Deleting all market requests...');
    const requestSnapshot = await db.collection('marketRequests').get();
    const requestBatch = db.batch();
    requestSnapshot.docs.forEach(doc => {
      requestBatch.delete(doc.ref);
    });
    await requestBatch.commit();
    console.log(`✅ Deleted ${requestSnapshot.size} market requests\n`);

    // 7. Reset all user rep to 1000
    console.log('Resetting user rep to 1000...');
    const usersSnapshot = await db.collection('users').get();
    const usersBatch = db.batch();
    usersSnapshot.docs.forEach(doc => {
      usersBatch.update(doc.ref, {
        weeklyRep: round2(1000),
        lifetimeRep: round2(0),
        onboardingComplete: true
      });
    });
    await usersBatch.commit();
    console.log(`✅ Reset ${usersSnapshot.size} users to $1,000\n`);

    console.log('✨ Database reset complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

// Confirmation prompt
console.log('⚠️  WARNING: This will DELETE ALL data and reset user balance to $1,000!');
console.log('This action cannot be undone.\n');
console.log('Type "RESET" to confirm: ');

process.stdin.once('data', (data) => {
  const input = data.toString().trim();
  if (input === 'RESET') {
    resetDatabase();
  } else {
    console.log('❌ Reset cancelled');
    process.exit(0);
  }
});
