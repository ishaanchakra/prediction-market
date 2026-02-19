// scripts/backfill-oracle-scores.js
// One-time script to compute and store Oracle Scores for all users
// based on historically resolved markets.
//
// Run with: node scripts/backfill-oracle-scores.js [--dry-run]
//
// This script is IDEMPOTENT — it overwrites (not increments) oracleScore,
// so it can be safely re-run.

const admin = require('firebase-admin');

const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const isDryRun = process.argv.includes('--dry-run');

// ─── Oracle Score logic (mirrors utils/oracleScore.js) ────────────────────────

function calculateMarketContribution({ userBets, resolution }) {
  if (!resolution || (resolution !== 'YES' && resolution !== 'NO')) return null;
  if (!Array.isArray(userBets) || userBets.length === 0) return null;

  const winningSide = resolution;

  const winningBuys = userBets.filter(
    (bet) => bet.refunded !== true && bet.type !== 'SELL' && bet.side === winningSide
  );
  const winningSells = userBets.filter(
    (bet) => bet.refunded !== true && bet.type === 'SELL' && bet.side === winningSide
  );

  const buyShares = winningBuys.reduce((sum, bet) => sum + Math.abs(Number(bet.shares || 0)), 0);
  const sellShares = winningSells.reduce((sum, bet) => sum + Math.abs(Number(bet.shares || 0)), 0);
  const netShares = buyShares - sellShares;

  if (netShares <= 0) return null;

  let totalWeightedPrice = 0;
  let totalBuyShares = 0;
  for (const bet of winningBuys) {
    const shares = Math.abs(Number(bet.shares || 0));
    const amount = Math.abs(Number(bet.amount || 0));
    if (shares <= 0) continue;
    const entryPrice = amount / shares;
    totalWeightedPrice += entryPrice * shares;
    totalBuyShares += shares;
  }

  if (totalBuyShares === 0) return null;

  const avgEntryPrice = totalWeightedPrice / totalBuyShares;
  const contrarianBonus = 1 - avgEntryPrice;
  if (contrarianBonus <= 0) return null;

  return {
    contribution: netShares * contrarianBonus,
    sharesOnCorrectSide: netShares,
    avgEntryPrice
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function commitBatch(ops) {
  const chunks = chunkArray(ops, 400);
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const { ref, data } of chunk) {
      batch.update(ref, data);
    }
    await batch.commit();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function backfillOracleScores() {
  console.log(`🔮 Oracle Score backfill${isDryRun ? ' (DRY RUN)' : ''}...\n`);

  // 1. Fetch all resolved markets (YES or NO), exclude CANCELLED
  console.log('Fetching resolved markets...');
  const [yesSnap, noSnap] = await Promise.all([
    db.collection('markets').where('resolution', '==', 'YES').get(),
    db.collection('markets').where('resolution', '==', 'NO').get()
  ]);

  const resolvedMarkets = [
    ...yesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    ...noSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  ].filter((m) => m.status !== 'CANCELLED' && !m.marketplaceId);

  console.log(`  Found ${resolvedMarkets.length} resolved global markets.\n`);

  if (resolvedMarkets.length === 0) {
    console.log('No resolved markets found. Nothing to backfill.');
    return;
  }

  // 2. Build marketsById
  const marketsById = Object.fromEntries(resolvedMarkets.map((m) => [m.id, m]));
  const resolvedMarketIds = resolvedMarkets.map((m) => m.id);

  // 3. Fetch all non-refunded bets for resolved markets (in chunks of 10 for 'in' queries)
  console.log('Fetching bets for resolved markets...');
  const idChunks = chunkArray(resolvedMarketIds, 10);
  const betSnapshots = await Promise.all(
    idChunks.map((chunk) =>
      db.collection('bets')
        .where('marketId', 'in', chunk)
        .where('marketplaceId', '==', null)
        .get()
    )
  );

  const allBets = betSnapshots.flatMap((snap) =>
    snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  ).filter((bet) => bet.refunded !== true);

  console.log(`  Found ${allBets.length} qualifying bets.\n`);

  // 4. Group bets by userId, then by marketId
  const betsByUserByMarket = {};
  for (const bet of allBets) {
    if (!bet.userId || !bet.marketId) continue;
    if (!betsByUserByMarket[bet.userId]) betsByUserByMarket[bet.userId] = {};
    if (!betsByUserByMarket[bet.userId][bet.marketId]) betsByUserByMarket[bet.userId][bet.marketId] = [];
    betsByUserByMarket[bet.userId][bet.marketId].push(bet);
  }

  // 5. Compute oracle score per user
  console.log('Computing oracle scores...');
  const oracleScoreByUser = {};

  for (const [userId, byMarket] of Object.entries(betsByUserByMarket)) {
    let total = 0;
    for (const [marketId, userBets] of Object.entries(byMarket)) {
      const market = marketsById[marketId];
      if (!market) continue;

      const result = calculateMarketContribution({ userBets, resolution: market.resolution });
      if (result && result.contribution > 0) {
        total += result.contribution;
      }
    }
    if (total > 0) {
      oracleScoreByUser[userId] = total;
    }
  }

  const scoredUsers = Object.keys(oracleScoreByUser);
  console.log(`  Computed scores for ${scoredUsers.length} users.\n`);

  if (scoredUsers.length === 0) {
    console.log('No scores to write. Done.');
    return;
  }

  // Print top 10 for review
  const sorted = scoredUsers
    .map((uid) => ({ uid, score: oracleScoreByUser[uid] }))
    .sort((a, b) => b.score - a.score);

  console.log('Top 10 oracle scores:');
  sorted.slice(0, 10).forEach((entry, i) => {
    console.log(`  ${String(i + 1).padStart(2, '0')}. ${entry.uid} — ${entry.score.toFixed(2)} pts`);
  });
  console.log('');

  if (isDryRun) {
    console.log('DRY RUN: no writes performed.');
    return;
  }

  // 6. Fetch all users to ensure refs exist, then write oracleScore
  console.log('Writing oracle scores to user documents...');

  // First: reset oracleScore to 0 for users NOT in scoredUsers
  // (so re-running this script clears stale scores)
  const allUsersSnap = await db.collection('users').get();
  const allUserIds = allUsersSnap.docs.map((d) => d.id);

  const writeOps = [];
  for (const userId of allUserIds) {
    const ref = db.collection('users').doc(userId);
    const score = oracleScoreByUser[userId] || 0;
    writeOps.push({ ref, data: { oracleScore: score } });
  }

  await commitBatch(writeOps);
  console.log(`✅ Wrote oracleScore for ${writeOps.length} user documents (${scoredUsers.length} non-zero).`);
}

backfillOracleScores()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
