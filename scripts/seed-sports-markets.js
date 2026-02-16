// scripts/seed-sports-markets.js
// Run with:
//   node scripts/seed-sports-markets.js --sport=hockey
//   node scripts/seed-sports-markets.js --sport=basketball --dry-run

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const TEAM_ID = '172';
const DEFAULT_PROBABILITY = 0.5;
const DEFAULT_B = 100;

const SPORTS_MAP = {
  hockey:     { sport: 'hockey',     league: 'mens-college-hockey' },
  basketball: { sport: 'basketball', league: 'mens-college-basketball' },
  football:   { sport: 'football',   league: 'college-football' },
  lacrosse:   { sport: 'lacrosse',   league: 'mens-college-lacrosse' },
  baseball:   { sport: 'baseball',   league: 'college-baseball' },
  soccer:     { sport: 'soccer',     league: 'mens-college-soccer' },
};

function parseArgs(argv) {
  let sportFlag = 'hockey';
  let dryRun = false;

  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('--sport=')) {
      sportFlag = arg.split('=')[1]?.trim().toLowerCase() || '';
      continue;
    }

    if (arg === '--sport') {
      // Supports: --sport hockey
      continue;
    }
  }

  const sportIndex = argv.findIndex((a) => a === '--sport');
  if (sportIndex >= 0 && argv[sportIndex + 1]) {
    sportFlag = String(argv[sportIndex + 1]).trim().toLowerCase();
  }

  if (!SPORTS_MAP[sportFlag]) {
    const validSports = Object.keys(SPORTS_MAP).join(', ');
    console.error(`Error: Unrecognized sport "${sportFlag}". Valid options: ${validSports}`);
    process.exit(1);
  }

  return { sportFlag, dryRun };
}

function ensureServiceAccount() {
  const serviceAccountPath = path.resolve(__dirname, '../serviceAccountKey.json');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('Error: serviceAccountKey.json not found. This file is required to run admin scripts.');
    process.exit(1);
  }

  // Same pattern as other admin scripts.
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

function formatMonthDay(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function formatFullDate(date) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

function getOpponentName(competitors) {
  const opponent = competitors.find(
    (teamEntry) => String(teamEntry?.team?.id || '') !== TEAM_ID
  );
  return opponent?.team?.displayName || opponent?.team?.shortDisplayName || 'Opponent';
}

async function fetchSchedule(sportFlag) {
  const cfg = SPORTS_MAP[sportFlag];

  let fetchImpl = globalThis.fetch;
  if (!fetchImpl) {
    try {
      fetchImpl = require('node-fetch');
    } catch (error) {
      throw new Error(
        `Fetch is not available in this Node runtime (${process.version}), and node-fetch is not installed.`
      );
    }
  }

  const endpoint = `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/teams/${TEAM_ID}/schedule`;
  const response = await fetchImpl(endpoint);
  if (!response.ok) {
    throw new Error(`ESPN schedule request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function getUpcomingGames(scheduleData) {
  const now = Date.now();
  const events = Array.isArray(scheduleData?.events) ? scheduleData.events : [];

  return events
    .map((event) => {
      const competition = event?.competitions?.[0];
      const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
      const statusType = competition?.status?.type || {};
      const date = event?.date ? new Date(event.date) : null;

      return {
        id: String(event?.id || ''),
        date,
        competitors,
        venueName: competition?.venue?.fullName || '',
        completed: Boolean(statusType.completed),
        statusName: String(statusType.name || '')
      };
    })
    .filter((game) => game.id && game.date instanceof Date && !Number.isNaN(game.date.getTime()))
    .filter((game) => game.date.getTime() > now)
    .filter((game) => !game.completed)
    .filter((game) => !['STATUS_FINAL', 'STATUS_CANCELLED'].includes(game.statusName));
}

async function seedSportsMarkets() {
  const { sportFlag, dryRun } = parseArgs(process.argv);
  ensureServiceAccount();
  const db = admin.firestore();
  const sportLabel = sportFlag.charAt(0).toUpperCase() + sportFlag.slice(1);

  console.log('Predict Cornell — Sports Market Seeder');
  console.log(`Sport: ${sportFlag}`);
  console.log('Fetching schedule from ESPN...\n');

  let scheduleData;
  try {
    scheduleData = await fetchSchedule(sportFlag);
  } catch (error) {
    console.error(`Error fetching ESPN schedule: ${error.message}`);
    process.exit(1);
  }

  const upcomingGames = getUpcomingGames(scheduleData);
  if (upcomingGames.length === 0) {
    console.log(`No upcoming games found for Cornell ${sportFlag}. Nothing to create.`);
    process.exit(0);
  }

  console.log(`Found ${upcomingGames.length} upcoming games.\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < upcomingGames.length; i += 1) {
    const game = upcomingGames[i];
    const opponentName = getOpponentName(game.competitors);
    const dateLabel = formatMonthDay(game.date);
    const fullDateString = formatFullDate(game.date);
    const question = `Will Cornell ${sportLabel} beat ${opponentName} on ${dateLabel}?`;
    const resolutionRules = `Resolves YES if Cornell wins. Resolves NO if Cornell loses or the game is cancelled. Source: ESPN game ID ${game.id}. Scheduled: ${fullDateString}.`;

    console.log(`  [${i + 1}/${upcomingGames.length}] ${question}`);

    try {
      const existing = await db
        .collection('markets')
        .where('espnGameId', '==', game.id)
        .limit(1)
        .get();

      if (!existing.empty) {
        skipped += 1;
        console.log(`         → SKIP — market already exists for game ${game.id}\n`);
        continue;
      }

      const qYes = DEFAULT_B * Math.log(DEFAULT_PROBABILITY / (1 - DEFAULT_PROBABILITY));

      if (dryRun) {
        created += 1;
        console.log('         → DRY RUN (would create)\n');
        continue;
      }

      const docRef = await db.collection('markets').add({
        question,
        resolutionRules,
        probability: DEFAULT_PROBABILITY,
        initialProbability: DEFAULT_PROBABILITY,
        outstandingShares: {
          yes: qYes,
          no: 0
        },
        b: DEFAULT_B,
        status: 'OPEN',
        resolution: null,
        resolvedAt: null,
        lockedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        espnGameId: game.id,
        sport: sportFlag,
        autoGenerated: true,
        venueName: game.venueName || null
      });

      created += 1;
      console.log(`         → CREATED (market id: ${docRef.id})\n`);
    } catch (error) {
      errors += 1;
      console.log(`         → ERROR (${error.message})\n`);
    }
  }

  console.log(`Done. ${created} markets created, ${skipped} skipped, ${errors} errors.`);
  process.exit(0);
}


seedSportsMarkets().catch((error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});
