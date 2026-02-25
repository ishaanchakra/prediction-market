// scripts/create-dogfood-user.js
// One-shot script to create the dogfood test user for automated browser testing.
//
// Run with: node scripts/create-dogfood-user.js
// Requires: serviceAccountKey.json in the repo root

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const auth = admin.auth();

const UID = 'dogfood-test-user';
const EMAIL = 'dogfood@cornell.edu';
const DISPLAY_NAME = 'DogfoodTester';
const DISPLAY_NAME_NORMALIZED = 'dogfoodtester';

async function run() {
  // 1. Create Auth user (skip if already exists)
  try {
    await auth.createUser({ uid: UID, email: EMAIL, displayName: 'Dogfood Tester' });
    console.log(`Created Auth user: ${UID}`);
  } catch (err) {
    if (err.code === 'auth/uid-already-exists') {
      console.log(`Auth user already exists: ${UID} (skipping)`);
    } else {
      throw err;
    }
  }

  // 2. Generate a custom token
  const token = await auth.createCustomToken(UID);

  // 3. Upsert Firestore documents
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`users/${UID}`).set(
    {
      weeklyRep: 1000,
      lifetimeRep: 0,
      oracleScore: 0,
      onboardingComplete: true,
      displayName: DISPLAY_NAME,
      displayNameNormalized: DISPLAY_NAME_NORMALIZED,
      createdAt: now,
    },
    { merge: true }
  );
  console.log(`Upserted users/${UID}`);

  await db.doc(`userPrivate/${UID}`).set(
    { email: EMAIL, updatedAt: now },
    { merge: true }
  );
  console.log(`Upserted userPrivate/${UID}`);

  await db.doc(`displayNames/${DISPLAY_NAME_NORMALIZED}`).set(
    { uid: UID, createdAt: now },
    { merge: true }
  );
  console.log(`Upserted displayNames/${DISPLAY_NAME_NORMALIZED}`);

  // 4. Print summary
  console.log('\n--- Dogfood user ready ---');
  console.log(`UID:          ${UID}`);
  console.log(`Email:        ${EMAIL}`);
  console.log(`Display name: ${DISPLAY_NAME}`);
  console.log(`\nCustom token (expires in 1 hour):\n${token}\n`);
  console.log('Set NEXT_PUBLIC_DOGFOOD_TOKEN=<token> in your Vercel env vars before testing.');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
