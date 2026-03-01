// scripts/backfill-oracle-scores.js
// Recompute Oracle Score using Brier calibration logic.
//
// Run with:
//   node scripts/backfill-oracle-scores.js
//   node scripts/backfill-oracle-scores.js --dry-run

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

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') {
    const nanos = Number(value.nanoseconds || 0);
    return (value.seconds * 1000) + Math.floor(nanos / 1e6);
  }
  const parsed = new Date(value);
  const ts = parsed.getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function normalizeType(value) {
  return value === 'SELL' ? 'SELL' : 'BUY';
}

function normalizeSide(value) {
  return value === 'NO' ? 'NO' : 'YES';
}

function outcomeFromResolution(resolution) {
  if (resolution === 'YES') return 1;
  if (resolution === 'NO') return 0;
  return null;
}

function toDisplayOracleScore(rawBrierAvg) {
  const rescaled = ((rawBrierAvg - 0.75) / 0.25) * 100;
  if (rescaled < 0) return 0;
  if (rescaled > 100) return 100;
  return rescaled;
}

function calculateMarketContribution({ userBets, resolution }) {
  const outcome = outcomeFromResolution(resolution);
  if (outcome == null) return null;
  if (!Array.isArray(userBets) || userBets.length === 0) return null;

  const nonRefunded = userBets.filter((bet) => bet && bet.refunded !== true);
  if (nonRefunded.length === 0) return null;

  const sorted = [...nonRefunded].sort(
    (a, b) => toMillis(b.createdAt || b.timestamp) - toMillis(a.createdAt || a.timestamp)
  );
  const lastAction = sorted[0];
  if (!lastAction) return null;

  // Only score users who held a net position at resolution (fully exited positions don't count).
  let netYesShares = 0;
  let netNoShares = 0;
  for (const bet of nonRefunded) {
    const betType = normalizeType(bet.type);
    const betSide = normalizeSide(bet.side);
    const shares = Math.abs(Number(bet.shares || 0));
    if (betSide === 'YES') {
      netYesShares += betType === 'BUY' ? shares : -shares;
    } else {
      netNoShares += betType === 'BUY' ? shares : -shares;
    }
  }
  if (Math.max(0, netYesShares) <= 0.001 && Math.max(0, netNoShares) <= 0.001) return null;

  const impliedProbability = clamp01(lastAction.marketProbabilityAtBet ?? lastAction.probability);
  if (impliedProbability == null) return null;

  const error = outcome - impliedProbability;
  const brierScore = 1 - (error * error);

  return {
    brierScore,
    impliedProbability,
    lastActionType: `${normalizeType(lastAction.type)}_${normalizeSide(lastAction.side)}`
  };
}

async function commitBatch(writeOps) {
  const chunks = chunkArray(writeOps, 400);
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const { ref, data } of chunk) {
      batch.update(ref, data);
    }
    await batch.commit();
  }
}

async function backfillOracleScores() {
  console.log(`\\n🔮 Oracle Score Brier backfill${isDryRun ? ' (DRY RUN)' : ''}\\n`);

  console.log('1) Fetching resolved global markets...');
  const [yesSnap, noSnap] = await Promise.all([
    db.collection('markets').where('resolution', '==', 'YES').get(),
    db.collection('markets').where('resolution', '==', 'NO').get()
  ]);

  const resolvedMarkets = [
    ...yesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
    ...noSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
  ].filter((market) => !market.marketplaceId && market.status !== 'CANCELLED');

  if (resolvedMarkets.length === 0) {
    console.log('No resolved global YES/NO markets found. Nothing to do.');
    return;
  }

  console.log(`   Found ${resolvedMarkets.length} resolved global markets.`);

  const resolvedMarketIds = resolvedMarkets.map((market) => market.id);
  const marketsById = Object.fromEntries(resolvedMarkets.map((market) => [market.id, market]));

  console.log('2) Fetching bets for those markets (client-side filtering for marketProbabilityAtBet)...');
  const marketChunks = chunkArray(resolvedMarketIds, 10);
  const betSnaps = await Promise.all(
    marketChunks.map((chunk) =>
      db.collection('bets')
        .where('marketId', 'in', chunk)
        .where('marketplaceId', '==', null)
        .get()
    )
  );

  const allBets = betSnaps.flatMap((snapshot) =>
    snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
  );

  const betsWithProbability = allBets.filter((bet) => Number.isFinite(Number(bet.marketProbabilityAtBet)));

  console.log(`   Loaded ${allBets.length} total global bets on resolved markets.`);
  console.log(`   ${betsWithProbability.length} bets include marketProbabilityAtBet.`);

  console.log('3) Grouping bets by user and market...');
  const betsByUserByMarket = {};
  for (const bet of allBets) {
    if (!bet.userId || !bet.marketId) continue;
    if (!betsByUserByMarket[bet.userId]) betsByUserByMarket[bet.userId] = {};
    if (!betsByUserByMarket[bet.userId][bet.marketId]) betsByUserByMarket[bet.userId][bet.marketId] = [];
    betsByUserByMarket[bet.userId][bet.marketId].push(bet);
  }

  console.log('4) Calculating oracleRawBrierSum / oracleMarketsScored / oracleScore per user...');
  const oracleByUser = {};

  for (const [userId, byMarket] of Object.entries(betsByUserByMarket)) {
    let rawBrierSum = 0;
    let marketsScored = 0;

    for (const [marketId, userBets] of Object.entries(byMarket)) {
      const market = marketsById[marketId];
      if (!market) continue;

      const result = calculateMarketContribution({ userBets, resolution: market.resolution });
      if (!result || !Number.isFinite(result.brierScore)) continue;

      rawBrierSum += result.brierScore;
      marketsScored += 1;
    }

    const rawBrierAvg = marketsScored > 0 ? rawBrierSum / marketsScored : 0;
    const oracleScore = marketsScored > 0 ? toDisplayOracleScore(rawBrierAvg) : 0;

    oracleByUser[userId] = {
      oracleRawBrierSum: rawBrierSum,
      oracleMarketsScored: marketsScored,
      oracleScore
    };
  }

  const scoredUsers = Object.entries(oracleByUser)
    .filter(([, data]) => Number(data.oracleMarketsScored || 0) > 0)
    .sort((a, b) => Number(b[1].oracleScore || 0) - Number(a[1].oracleScore || 0));

  console.log(`   Computed scores for ${scoredUsers.length} users (marketsScored >= 1).`);

  if (scoredUsers.length > 0) {
    console.log('   Top 10 by Oracle Score:');
    scoredUsers.slice(0, 10).forEach(([userId, data], index) => {
      console.log(
        `   ${String(index + 1).padStart(2, '0')}. ${userId} — ${Number(data.oracleScore).toFixed(2)} pts (${data.oracleMarketsScored} markets)`
      );
    });
  }

  if (isDryRun) {
    console.log('\\nDRY RUN: no writes performed.');
    return;
  }

  console.log('5) Writing all three oracle fields to users in batch...');
  const usersSnap = await db.collection('users').get();

  const writeOps = usersSnap.docs.map((userDoc) => {
    const stats = oracleByUser[userDoc.id] || {
      oracleRawBrierSum: 0,
      oracleMarketsScored: 0,
      oracleScore: 0
    };

    return {
      ref: userDoc.ref,
      data: {
        oracleRawBrierSum: Number(stats.oracleRawBrierSum || 0),
        oracleMarketsScored: Number(stats.oracleMarketsScored || 0),
        oracleScore: Number(stats.oracleScore || 0)
      }
    };
  });

  await commitBatch(writeOps);

  console.log(`✅ Updated ${writeOps.length} users.`);
  console.log(`✅ Users with >=1 scored market: ${scoredUsers.length}.`);
}

backfillOracleScores()
  .then(() => {
    console.log('\\nDone.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
