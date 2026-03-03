#!/usr/bin/env node

const path = require('path');
const admin = require('firebase-admin');

const BATCH_LIMIT = 500;
const DEFAULT_MARKET_B = 100;
const LEADERBOARD_CACHE_COLLECTIONS = ['weeklySnapshots'];

function parseArgs(argv = process.argv.slice(2)) {
  const confirm = argv.includes('--confirm');
  return {
    confirm,
    dryRun: !confirm
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefixed(message, dryRun) {
  return dryRun ? `[DRY RUN] ${message}` : message;
}

function log(message, dryRun) {
  console.log(prefixed(message, dryRun));
}

function chunkArray(items, size = BATCH_LIMIT) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function ensureAdminDb() {
  if (admin.apps.length === 0) {
    const keyPath = path.resolve(__dirname, '../serviceAccountKey.json');
    const serviceAccount = require(keyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return admin.firestore();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round6(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
}

function resolveAccountCreatedAt(existingData = {}, FieldValue = admin.firestore.FieldValue) {
  if (existingData.accountCreatedAt) {
    return { value: existingData.accountCreatedAt, source: 'accountCreatedAt' };
  }
  if (existingData.createdAt) {
    return { value: existingData.createdAt, source: 'createdAt' };
  }
  return { value: FieldValue.serverTimestamp(), source: 'serverTimestamp()' };
}

function buildUserResetPatch(existingData = {}, FieldValue = admin.firestore.FieldValue) {
  const { value: accountCreatedAt, source: accountCreatedAtSource } = resolveAccountCreatedAt(existingData, FieldValue);

  const patch = {
    balance: 1000,
    totalDeposits: 1000,
    accountCreatedAt,
    lastStipendWeek: null,
    oracleScore: 0,
    oracleMarketsScored: 0,
    oracleRawBrierSum: 0,
    onboardingComplete: true,
    quickTakesUsedToday: 0,
    quickTakeLastDate: null,
    quickTakeStreak: 0,
    lifetimeRep: 0
  };

  const removedLegacyFields = [];
  const legacyFields = ['weeklyRep', 'weeklyStartingBalance', 'weeklyNet'];
  for (const field of legacyFields) {
    if (Object.prototype.hasOwnProperty.call(existingData, field)) {
      patch[field] = FieldValue.delete();
      removedLegacyFields.push(field);
    }
  }

  return { patch, removedLegacyFields, accountCreatedAtSource };
}

function normalizeProbability(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const decimal = numeric > 1 ? numeric / 100 : numeric;
  const clamped = Math.max(0.01, Math.min(0.99, decimal));
  return round2(clamped);
}

function resolveInitialProbability(marketData = {}) {
  const fromInitial = normalizeProbability(marketData.initialProbability);
  if (fromInitial != null) return { value: fromInitial, source: 'initialProbability' };

  const fromCurrent = normalizeProbability(marketData.probability);
  if (fromCurrent != null) return { value: fromCurrent, source: 'probability' };

  return { value: 0.5, source: 'default(0.5)' };
}

function resolveMarketB(marketData = {}) {
  const b = toNumber(marketData.b, DEFAULT_MARKET_B);
  return b > 0 ? b : DEFAULT_MARKET_B;
}

function buildMarketResetPatch(marketData = {}, FieldValue = admin.firestore.FieldValue) {
  const { value: initialProbability, source: probabilitySource } = resolveInitialProbability(marketData);
  const b = resolveMarketB(marketData);
  const qYes = b * Math.log(initialProbability / (1 - initialProbability));

  return {
    patch: {
      probability: initialProbability,
      initialProbability,
      outstandingShares: {
        yes: round6(qYes),
        no: 0
      },
      volume: 0,
      totalVolume: 0,
      totalTraded: 0,
      tradeCount: 0,
      betCount: 0,
      bettors: 0,
      lastTradeAt: FieldValue.delete()
    },
    probabilitySource,
    b
  };
}

async function deleteCollectionDocuments(db, collectionName, { dryRun }) {
  log(`Scanning ${collectionName}...`, dryRun);
  const snapshot = await db.collection(collectionName).get();
  const count = snapshot.size;

  if (count === 0) {
    log(`${collectionName}: 0 documents found`, dryRun);
    return 0;
  }

  log(`${collectionName}: ${count} documents found`, dryRun);
  const chunks = chunkArray(snapshot.docs, BATCH_LIMIT);

  if (dryRun) {
    log(`${collectionName}: would delete ${count} documents in ${chunks.length} batch(es).`, dryRun);
    return count;
  }

  let deleted = 0;
  for (const docsChunk of chunks) {
    const batch = db.batch();
    for (const docSnap of docsChunk) {
      batch.delete(docSnap.ref);
    }
    await batch.commit();
    deleted += docsChunk.length;
    log(`${collectionName}: deleted ${deleted}/${count}`, dryRun);
  }

  return deleted;
}

function isResolvedOrCancelledMarket(marketData = {}) {
  const status = String(marketData.status || '').toUpperCase();
  if (status === 'RESOLVED' || status === 'CANCELLED') return true;
  return marketData.resolution === 'YES' || marketData.resolution === 'NO';
}

async function resetMarketsToStartingProbabilities(db, { dryRun }) {
  log('Scanning markets...', dryRun);
  const snapshot = await db.collection('markets').get();
  const count = snapshot.size;

  if (count === 0) {
    log('markets: 0 documents found', dryRun);
    return { reset: 0, skipped: 0 };
  }

  const operations = [];
  let skipped = 0;

  for (const docSnap of snapshot.docs) {
    const marketData = docSnap.data() || {};
    if (isResolvedOrCancelledMarket(marketData)) {
      skipped += 1;
      log(`Market ${docSnap.id}: skipped (status/resolution preserved)`, dryRun);
      continue;
    }

    const { patch, probabilitySource, b } = buildMarketResetPatch(marketData);
    log(
      `Market ${docSnap.id}: reset to initial prob=${patch.initialProbability} (${probabilitySource}), b=${b}, pool={yes:${patch.outstandingShares.yes}, no:0}`,
      dryRun
    );
    operations.push({ ref: docSnap.ref, patch });
  }

  if (operations.length === 0) {
    log(`markets: no open/active markets to reset (${skipped} skipped)`, dryRun);
    return { reset: 0, skipped };
  }

  if (dryRun) {
    log(`markets: would reset ${operations.length} market(s) (${skipped} skipped)`, dryRun);
    return { reset: operations.length, skipped };
  }

  let reset = 0;
  for (const chunk of chunkArray(operations, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const operation of chunk) {
      batch.update(operation.ref, operation.patch);
    }
    await batch.commit();
    reset += chunk.length;
    log(`markets: reset ${reset}/${operations.length}`, dryRun);
  }

  return { reset, skipped };
}

async function resetUsersCollection(db, { dryRun }) {
  log('Scanning users...', dryRun);
  const snapshot = await db.collection('users').get();
  const count = snapshot.size;

  if (count === 0) {
    log('users: 0 documents found', dryRun);
    return 0;
  }

  log(`users: ${count} documents found`, dryRun);

  const operations = snapshot.docs.map((docSnap) => {
    const existingData = docSnap.data() || {};
    const displayName = existingData.displayName || existingData.uid || docSnap.id;
    const { patch, removedLegacyFields, accountCreatedAtSource } = buildUserResetPatch(existingData);
    const removedText = removedLegacyFields.length > 0
      ? `; delete ${removedLegacyFields.join(', ')}`
      : '';

    log(
      `User ${displayName} (${docSnap.id}): set balance=1000, totalDeposits=1000, accountCreatedAt=${accountCreatedAtSource}, lastStipendWeek=null, oracleScore=0, oracleMarketsScored=0, oracleRawBrierSum=0, onboardingComplete=true, quickTakesUsedToday=0, quickTakeLastDate=null, quickTakeStreak=0, lifetimeRep=0${removedText}`,
      dryRun
    );

    return {
      ref: docSnap.ref,
      patch
    };
  });

  if (dryRun) {
    log(`users: would reset ${operations.length} users`, dryRun);
    return operations.length;
  }

  let updated = 0;
  for (const chunk of chunkArray(operations, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const operation of chunk) {
      batch.update(operation.ref, operation.patch);
    }
    await batch.commit();
    updated += chunk.length;
    log(`users: reset ${updated}/${operations.length}`, dryRun);
  }

  return updated;
}

async function clearLeaderboardCaches(db, { dryRun }) {
  const results = {};
  for (const collectionName of LEADERBOARD_CACHE_COLLECTIONS) {
    results[collectionName] = await deleteCollectionDocuments(db, collectionName, { dryRun });
  }
  return results;
}

async function runConfirmCountdown() {
  console.log('⚠️ THIS WILL PERMANENTLY DELETE ALL BETS, RESET OPEN MARKETS TO STARTING PROBABILITIES, CLEAR LEADERBOARD SNAPSHOTS, AND RESET ALL USER ACCOUNTS TO $1,000. Executing in 5... 4... 3... 2... 1...');
  await sleep(5000);
}

async function runHardReset({ dryRun, confirm }) {
  if (!dryRun && !confirm) {
    throw new Error('Live mode requires --confirm.');
  }

  if (!dryRun) {
    await runConfirmCountdown();
  }

  const db = ensureAdminDb();

  const summary = {
    betsDeleted: await deleteCollectionDocuments(db, 'bets', { dryRun }),
    marketsReset: 0,
    marketsSkipped: 0,
    leaderboardSnapshotsDeleted: 0,
    usersReset: 0
  };

  const marketResult = await resetMarketsToStartingProbabilities(db, { dryRun });
  summary.marketsReset = marketResult.reset;
  summary.marketsSkipped = marketResult.skipped;

  const cacheResult = await clearLeaderboardCaches(db, { dryRun });
  summary.leaderboardSnapshotsDeleted = cacheResult.weeklySnapshots || 0;

  summary.usersReset = await resetUsersCollection(db, { dryRun });

  log('=== LAUNCH WIPE SUMMARY ===', dryRun);
  log(`Bets deleted: ${summary.betsDeleted}`, dryRun);
  log(`Markets reset to starting probabilities: ${summary.marketsReset}`, dryRun);
  log(`Markets skipped (resolved/cancelled): ${summary.marketsSkipped}`, dryRun);
  log(`Leaderboard snapshots deleted: ${summary.leaderboardSnapshotsDeleted}`, dryRun);
  log(`Users reset: ${summary.usersReset}`, dryRun);

  return summary;
}

async function main() {
  const { dryRun, confirm } = parseArgs();
  try {
    if (dryRun) {
      log('Running in dry-run mode (default). Pass --confirm to execute writes.', dryRun);
    } else {
      log('Running in confirm mode. Live writes are enabled.', dryRun);
    }

    await runHardReset({ dryRun, confirm });
    process.exit(0);
  } catch (error) {
    console.error(prefixed(`ERROR: ${error?.stack || error?.message || error}`, dryRun));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  BATCH_LIMIT,
  DEFAULT_MARKET_B,
  LEADERBOARD_CACHE_COLLECTIONS,
  chunkArray,
  parseArgs,
  normalizeProbability,
  resolveInitialProbability,
  resolveMarketB,
  buildMarketResetPatch,
  resolveAccountCreatedAt,
  buildUserResetPatch,
  deleteCollectionDocuments,
  resetMarketsToStartingProbabilities,
  resetUsersCollection,
  clearLeaderboardCaches,
  runHardReset
};
