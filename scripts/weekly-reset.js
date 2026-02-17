// scripts/weekly-reset.js
// Run with:
//   node scripts/weekly-reset.js
//   node scripts/weekly-reset.js --dry-run
//   node scripts/weekly-reset.js --admin-email=ic367@cornell.edu

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const MARKET_STATUS_CANCELLED = 'CANCELLED';
const WEEKLY_BASELINE = 1000;

function round2(num) {
  return Math.round((Number(num) + Number.EPSILON) * 100) / 100;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, toNumber(value, 0.5)));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function mondayIso(date = new Date()) {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const adminEmailArg = argv.find((arg) => arg.startsWith('--admin-email='));
  const adminEmail = adminEmailArg ? adminEmailArg.split('=')[1] : 'system';
  return { dryRun, adminEmail };
}

function ensureServiceAccount() {
  const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: serviceAccountKey.json not found. This file is required to run admin scripts.');
    process.exit(1);
  }
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

async function fetchOpenMarketBets(db, openMarketIds) {
  if (openMarketIds.length === 0) return [];
  const chunks = chunkArray(openMarketIds, 10);
  const snapshots = await Promise.all(
    chunks.map((chunk) =>
      db.collection('bets').where('marketId', 'in', chunk).get()
    )
  );
  return snapshots.flatMap((snapshot) => snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
}

function calculatePortfolioRows({ users, bets, openMarkets }) {
  const openMarketsById = Object.fromEntries(openMarkets.map((market) => [market.id, market]));
  const openMarketIds = new Set(openMarkets.map((market) => market.id));
  const betsByUserId = new Map();

  for (const bet of bets) {
    if (!bet?.userId || !openMarketIds.has(bet.marketId)) continue;
    if (!betsByUserId.has(bet.userId)) betsByUserId.set(bet.userId, []);
    betsByUserId.get(bet.userId).push(bet);
  }

  return users.map((user) => {
    const userBets = betsByUserId.get(user.id) || [];
    const positionsByMarket = new Map();

    for (const bet of userBets) {
      if (!positionsByMarket.has(bet.marketId)) {
        positionsByMarket.set(bet.marketId, { yesShares: 0, noShares: 0 });
      }
      const position = positionsByMarket.get(bet.marketId);
      const type = bet.type === 'SELL' ? 'SELL' : 'BUY';
      const side = bet.side === 'NO' ? 'NO' : 'YES';
      const shares = Math.abs(toNumber(bet.shares, 0));
      if (side === 'YES') {
        position.yesShares += type === 'SELL' ? -shares : shares;
      } else {
        position.noShares += type === 'SELL' ? -shares : shares;
      }
    }

    let positionsValue = 0;
    for (const [marketId, position] of positionsByMarket.entries()) {
      const market = openMarketsById[marketId];
      if (!market) continue;
      const probability = clamp01(market.probability);
      const yesShares = Math.max(0, round2(position.yesShares));
      const noShares = Math.max(0, round2(position.noShares));
      positionsValue += yesShares * probability;
      positionsValue += noShares * (1 - probability);
    }

    const cashBalance = round2(toNumber(user.weeklyRep, 0));
    const roundedPositions = round2(positionsValue);
    const portfolioValue = round2(cashBalance + roundedPositions);
    return {
      ...user,
      cashBalance,
      positionsValue: roundedPositions,
      portfolioValue,
      weeklyNet: round2(portfolioValue - WEEKLY_BASELINE)
    };
  });
}

async function commitResetInChunks(db, userIds) {
  const chunks = chunkArray(userIds, 400);
  for (const chunk of chunks) {
    const batch = db.batch();
    chunk.forEach((userId) => {
      batch.update(db.collection('users').doc(userId), { weeklyRep: WEEKLY_BASELINE });
    });
    await batch.commit();
  }
}

async function run() {
  const { dryRun, adminEmail } = parseArgs(process.argv);
  ensureServiceAccount();
  const db = admin.firestore();

  console.log('Predict Cornell — Weekly Reset');
  if (dryRun) console.log('Mode: DRY RUN');

  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

  const openMarketsSnap = await db.collection('markets').where('resolution', '==', null).get();
  const openMarkets = openMarketsSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((market) => market.status !== MARKET_STATUS_CANCELLED);
  const openMarketIds = openMarkets.map((market) => market.id);

  const openBets = await fetchOpenMarketBets(db, openMarketIds);
  const rows = calculatePortfolioRows({ users, bets: openBets, openMarkets })
    .sort((a, b) => Number(b.portfolioValue || 0) - Number(a.portfolioValue || 0));

  const rankings = rows.slice(0, 50).map((row, index) => ({
    userId: row.id,
    displayName: row.displayName || row.email || `Trader ${row.id.slice(0, 4)}`,
    portfolioValue: round2(row.portfolioValue),
    netProfit: round2(row.weeklyNet),
    rank: index + 1
  }));
  const participants = new Set(openBets.map((bet) => bet.userId).filter(Boolean)).size;
  const champion = rankings[0];

  console.log(`Users: ${users.length}`);
  console.log(`Open markets: ${openMarkets.length}`);
  console.log(`Open-market bets: ${openBets.length}`);
  console.log(`Champion: ${champion ? `${champion.displayName} (${champion.netProfit >= 0 ? '+' : ''}$${champion.netProfit.toFixed(2)})` : '—'}`);

  if (dryRun) {
    console.log('DRY RUN complete. No writes were made.');
    process.exit(0);
  }

  await db.collection('weeklySnapshots').add({
    weekOf: mondayIso(),
    snapshotDate: new Date(),
    rankings,
    totalParticipants: participants
  });

  await commitResetInChunks(db, users.map((row) => row.id));

  await db.collection('adminLog').add({
    action: 'RESET',
    detail: `Weekly snapshot + reset completed (${rankings.length} ranked, ${participants} participants). All users set to $1,000.00`,
    adminEmail,
    timestamp: new Date()
  });

  console.log('Weekly snapshot saved and balances reset to $1,000.00.');
  process.exit(0);
}

run().catch((error) => {
  console.error('Error running weekly reset:', error);
  process.exit(1);
});
