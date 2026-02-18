// scripts/migrate-marketplace-null.js
// Run with: node scripts/migrate-marketplace-null.js

const admin = require('firebase-admin');

const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function applyNullMarketplaceId(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const docsToUpdate = snapshot.docs.filter((snapshotDoc) => !Object.prototype.hasOwnProperty.call(snapshotDoc.data(), 'marketplaceId'));

  if (docsToUpdate.length === 0) {
    console.log(`No ${collectionName} docs need updates.`);
    return 0;
  }

  const chunks = chunkArray(docsToUpdate, 400);
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((snapshotDoc) => {
      batch.update(snapshotDoc.ref, { marketplaceId: null });
    });
    await batch.commit();
  }

  console.log(`Updated ${docsToUpdate.length} ${collectionName} docs with marketplaceId: null`);
  return docsToUpdate.length;
}

async function run() {
  try {
    console.log('Running marketplaceId null migration...');
    const [marketsUpdated, betsUpdated] = await Promise.all([
      applyNullMarketplaceId('markets'),
      applyNullMarketplaceId('bets')
    ]);
    console.log(`Done. markets: ${marketsUpdated}, bets: ${betsUpdated}`);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

run();

