// scripts/cleanup-dogfood.js
// Removes all dogfood test user data from Firestore and Firebase Auth.
//
// Run with: node scripts/cleanup-dogfood.js
// Requires: serviceAccountKey.json in the repo root
// Idempotent — skips silently if docs or user don't exist.

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();

const UID = 'dogfood-test-user';

async function deleteDoc(path) {
  const ref = db.doc(path);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`  skipped (not found): ${path}`);
    return 0;
  }
  await ref.delete();
  console.log(`  deleted: ${path}`);
  return 1;
}

async function run() {
  let deleted = 0;

  // 1. Named Firestore docs
  console.log('\nDeleting Firestore docs...');
  deleted += await deleteDoc(`users/${UID}`);
  deleted += await deleteDoc(`userPrivate/${UID}`);
  deleted += await deleteDoc('displayNames/dogfoodtester');

  // 2. Bets by userId
  console.log('\nQuerying bets...');
  const betsSnap = await db.collection('bets').where('userId', '==', UID).get();
  if (betsSnap.empty) {
    console.log('  skipped (no bets found)');
  } else {
    const batch = db.batch();
    betsSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`  deleted ${betsSnap.size} bet(s)`);
    deleted += betsSnap.size;
  }

  // 3. Firebase Auth user
  console.log('\nDeleting Auth user...');
  try {
    await auth.deleteUser(UID);
    console.log(`  deleted Auth user: ${UID}`);
    deleted += 1;
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log(`  skipped (Auth user not found): ${UID}`);
    } else {
      throw err;
    }
  }

  console.log(`\n--- Cleanup complete: ${deleted} item(s) deleted ---\n`);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
