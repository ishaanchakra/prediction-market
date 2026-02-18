// scripts/bulk-create-markets.js
// Reads scripts/cornell-games.json and bulk-creates markets in Firestore.
// Requires serviceAccountKey.json in the project root.
//
// Usage:
//   node scripts/bulk-create-markets.js            # interactive create
//   node scripts/bulk-create-markets.js --dry-run  # preview only, no writes
//   node scripts/bulk-create-markets.js --sport mens-ice-hockey  # one sport only

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---- Config ----
const DEFAULT_PROBABILITY_PCT = 50;  // 50/50 starting point
const DEFAULT_LIQUIDITY_B = 100;     // matches admin panel default

// ---- Firebase init ----
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ serviceAccountKey.json not found at project root.');
  console.error('   Download it from: Firebase Console → Project settings → Service accounts');
  process.exit(1);
}
const serviceAccount = require(serviceAccountPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ---- Helpers ----
function round2(n) { return Math.round(n * 100) / 100; }

// Sport slug → natural language label
const SPORT_LABELS = {
  'mens-ice-hockey':    "Men's Hockey",
  'womens-ice-hockey':  "Women's Hockey",
  'mens-basketball':    "Men's Basketball",
  'womens-basketball':  "Women's Basketball",
  'wrestling':          'Wrestling',
  'mens-lacrosse':      "Men's Lacrosse",
  'womens-lacrosse':    "Women's Lacrosse",
  'baseball':           'Baseball',
  'softball':           'Softball',
};

// School name (lowercase, without University/College) → team nickname
// Keys ordered longest-first to ensure most-specific match wins during lookup
const OPPONENT_NICKNAMES = {
  'north carolina state': 'Wolfpack',
  'virginia military institute': 'Keydets',
  'boston university':   'Terriers',
  'james madison':       'Dukes',
  'morgan state':        'Bears',
  'st. bonaventure':     'Bonnies',
  'saint bonaventure':   'Bonnies',
  'st. lawrence':        'Saints',
  'saint lawrence':      'Saints',
  'high point':          'Panthers',
  'penn state':          'Nittany Lions',
  'le moyne':            'Dolphins',
  'nc state':            'Wolfpack',
  'quinnipiac':          'Bobcats',
  'princeton':           'Tigers',
  'harvard':             'Crimson',
  'yale':                'Bulldogs',
  'brown':               'Bears',
  'dartmouth':           'Big Green',
  'columbia':            'Lions',
  'clarkson':            'Golden Knights',
  'binghamton':          'Bearcats',
  'towson':              'Tigers',
  'duke':                'Blue Devils',
  'denver':              'Pioneers',
  'richmond':            'Spiders',
  'syracuse':            'Orange',
  'hobart':              'Statesmen',
  'bucknell':            'Bison',
  'colgate':             'Raiders',
  'fordham':             'Rams',
  'drexel':              'Dragons',
  'merrimack':           'Warriors',
  'army':                'Black Knights',
  'vmi':                 'Keydets',
  'northwestern':        'Wildcats',
  'rensselaer':          'Engineers',
  'cornell':             'Big Red',
  'penn':                'Quakers',
  'pennsylvania':        'Quakers',  // "University of Pennsylvania" → "Pennsylvania"
};

// Strip leading ranking prefix like "#5 " or "#17/#16 "
function stripRanking(name) {
  return name.replace(/^#\d+(\/#\d+)?\s+/, '');
}

function cleanDisplayName(s) {
  return s
    .replace(/^University of /i, '') // "University of Denver" → "Denver"
    .replace(/\s+University$/i, '')  // "Quinnipiac University" → "Quinnipiac"
    .replace(/\s+College$/i, '')     // "Dartmouth College" → "Dartmouth"
    .replace(/\s+\(DH\)$/i, '')     // doubleheader suffix
    .trim();
}

// Return "{SchoolName} {Nickname}" (e.g. "Quinnipiac Bobcats")
// Falls back to clean name if no nickname found
function getOpponentWithNickname(opponent) {
  const withoutRanking = stripRanking(opponent).replace(/\s+\(DH\)$/i, '').trim();
  const withoutRankingLower = withoutRanking.toLowerCase();

  // Try exact match on full name (handles "Boston University" → key "boston university")
  if (OPPONENT_NICKNAMES[withoutRankingLower]) {
    return `${cleanDisplayName(withoutRanking)} ${OPPONENT_NICKNAMES[withoutRankingLower]}`;
  }

  // Strip University/College suffix/prefix and try again
  const displayName = cleanDisplayName(withoutRanking);
  const displayLower = displayName.toLowerCase();

  if (OPPONENT_NICKNAMES[displayLower]) {
    return `${displayName} ${OPPONENT_NICKNAMES[displayLower]}`;
  }

  // Partial prefix match (longest key first to avoid e.g. "penn" matching "penn state")
  const sortedKeys = Object.keys(OPPONENT_NICKNAMES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (displayLower === key || displayLower.startsWith(key + ' ')) {
      return `${displayName} ${OPPONENT_NICKNAMES[key]}`;
    }
  }

  return displayName; // fallback: cleaned name only
}

// Extract "Feb 28" from "Fri, Feb 28, 2026"
function formatDateShort(dateText) {
  const match = dateText.match(/\b([A-Z][a-z]{2})\s+(\d{1,2}),\s+\d{4}/);
  if (match) return `${match[1]} ${match[2]}`;
  return dateText;
}

function makeQuestion(game) {
  const sportLabel = SPORT_LABELS[game.sport] || game.sportName;
  const opponentDisplay = getOpponentWithNickname(game.opponent);
  const dateShort = formatDateShort(game.dateText);
  return `Will Cornell ${sportLabel} beat the ${opponentDisplay} on ${dateShort}?`;
}

function makeResolutionRules(game) {
  const sportLabel = SPORT_LABELS[game.sport] || game.sportName;
  const opponentShort = cleanDisplayName(stripRanking(game.opponent));
  const dateShort = formatDateShort(game.dateText);
  return `Resolves YES if Cornell wins the ${sportLabel} game vs ${opponentShort} on ${dateShort}. Resolves NO if Cornell loses. Resolves N/A if cancelled/postponed.`;
}

function gameToMarketDoc(game, probabilityPct = DEFAULT_PROBABILITY_PCT, liquidityB = DEFAULT_LIQUIDITY_B) {
  const probDecimal = probabilityPct / 100;
  const qYes = liquidityB * Math.log(probDecimal / (1 - probDecimal));

  return {
    question: makeQuestion(game),
    resolutionRules: makeResolutionRules(game),
    probability: round2(probDecimal),
    initialProbability: round2(probDecimal),
    outstandingShares: {
      yes: round2(qYes),
      no: 0,
    },
    b: liquidityB,
    status: 'OPEN',
    resolution: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    category: 'sports',    // auto-categorized; 'beat'/'win' keywords also trigger it
    marketplaceId: null,
    // Extra metadata (not used by the app, but handy for reference)
    _gameDate: game.date,
    _sport: game.sport,
    _opponent: game.opponent,
    _homeAway: game.homeAway,
  };
}

async function dedupeGames(games) {
  // Skip games whose question already exists in Firestore (by question text)
  const existing = await db.collection('markets').get();
  const existingQuestions = new Set(existing.docs.map(d => (d.data().question || '').toLowerCase().trim()));
  const fresh = games.filter(g => {
    const q = makeQuestion(g).toLowerCase().trim();
    if (existingQuestions.has(q)) {
      console.log(`  ⏭  Skipping duplicate: ${makeQuestion(g)}`);
      return false;
    }
    return true;
  });
  return fresh;
}

async function createMarketsInBatches(games, dryRun) {
  const BATCH_SIZE = 490; // Firestore batch limit is 500 ops
  let created = 0;

  for (let i = 0; i < games.length; i += BATCH_SIZE) {
    const chunk = games.slice(i, i + BATCH_SIZE);
    if (dryRun) {
      chunk.forEach(g => console.log(`  [dry] ${makeQuestion(g)}`));
    } else {
      const batch = db.batch();
      chunk.forEach(g => {
        const ref = db.collection('markets').doc();
        batch.set(ref, gameToMarketDoc(g));
      });
      await batch.commit();
      created += chunk.length;
      console.log(`  ✅ Committed batch of ${chunk.length}`);
    }
  }
  return created;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipTournaments = args.includes('--skip-tournaments');

  const sportFilter = (() => {
    const idx = args.indexOf('--sport');
    return idx !== -1 ? args[idx + 1] : null;
  })();

  // --exclude baseball --exclude softball  (repeatable)
  const excludeSports = [];
  args.forEach((a, i) => { if (a === '--exclude' && args[i + 1]) excludeSports.push(args[i + 1].toLowerCase()); });

  // ---- Load games ----
  const gamesPath = path.join(__dirname, 'cornell-games.json');
  if (!fs.existsSync(gamesPath)) {
    console.error('❌ cornell-games.json not found.');
    console.error('   Run: node scripts/scrape-cornell-sports.js first.');
    process.exit(1);
  }
  let games = JSON.parse(fs.readFileSync(gamesPath, 'utf-8'));

  if (sportFilter) {
    games = games.filter(g => g.sport === sportFilter || g.sportName.toLowerCase().includes(sportFilter.toLowerCase()));
  }

  if (excludeSports.length > 0) {
    games = games.filter(g => !excludeSports.some(ex => g.sport.toLowerCase().includes(ex) || g.sportName.toLowerCase().includes(ex)));
    console.log(`Excluding: ${excludeSports.join(', ')}`);
  }

  if (skipTournaments) {
    const before = games.length;
    games = games.filter(g => !g.isTournament);
    console.log(`Skipped ${before - games.length} tournament placeholder(s)`);
  }

  if (games.length === 0) {
    console.log('No games to create markets for.');
    process.exit(0);
  }

  // ---- Show what we have ----
  console.log(`\nFound ${games.length} game${games.length === 1 ? '' : 's'} in cornell-games.json:\n`);
  games.forEach((g, i) => {
    const loc = g.homeAway === 'away' ? `@ ${g.opponent}` : `vs. ${g.opponent}`;
    console.log(`  ${String(i + 1).padStart(2)}. [${g.sportName}] ${loc} — ${g.dateText}`);
  });

  // ---- Dry run ----
  if (dryRun) {
    console.log('\n--- DRY RUN: Market questions that would be created ---\n');
    games.forEach(g => console.log(`  • ${makeQuestion(g)}`));
    console.log(`\n[DRY RUN] Would create ${games.length} markets. No writes made.`);
    console.log('Run without --dry-run to actually create them.');
    process.exit(0);
  }

  // ---- Deduplicate against existing Firestore markets ----
  console.log('\nChecking for duplicates in Firestore...');
  games = await dedupeGames(games);
  if (games.length === 0) {
    console.log('\nAll games already have markets. Nothing to create.');
    process.exit(0);
  }
  console.log(`\n${games.length} new market${games.length === 1 ? '' : 's'} to create.\n`);

  // ---- Confirm ----
  console.log('⚠️  This will write to your live Firestore database.');
  const answer = await prompt(`Type "CREATE" to create ${games.length} markets, or anything else to cancel: `);
  if (answer !== 'CREATE') {
    console.log('❌ Cancelled.');
    process.exit(0);
  }

  // ---- Create ----
  console.log('\nCreating markets...');
  const created = await createMarketsInBatches(games, false);
  console.log(`\n🎉 Done! Created ${created} new markets.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
