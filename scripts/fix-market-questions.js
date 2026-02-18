// scripts/fix-market-questions.js
// Updates existing sports markets in Firestore to the new natural-language question format.
// Only touches markets that have a _sport metadata field (created by bulk-create-markets.js).
//
// Usage:
//   node scripts/fix-market-questions.js            # interactive update
//   node scripts/fix-market-questions.js --dry-run  # preview only, no writes

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ---- Firebase init ----
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ serviceAccountKey.json not found at project root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(serviceAccountPath)) });
const db = admin.firestore();

// ---- Sport label map ----
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

// ---- Nickname lookup (longest keys first to prefer more-specific matches) ----
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

function getOpponentWithNickname(opponent) {
  const withoutRanking = stripRanking(opponent).replace(/\s+\(DH\)$/i, '').trim();
  const withoutRankingLower = withoutRanking.toLowerCase();

  // Try exact match on full name (e.g. "boston university" → "Boston Terriers")
  if (OPPONENT_NICKNAMES[withoutRankingLower]) {
    return `${cleanDisplayName(withoutRanking)} ${OPPONENT_NICKNAMES[withoutRankingLower]}`;
  }

  // Strip University/College suffix/prefix and try again
  const displayName = cleanDisplayName(withoutRanking);
  const displayLower = displayName.toLowerCase();

  if (OPPONENT_NICKNAMES[displayLower]) {
    return `${displayName} ${OPPONENT_NICKNAMES[displayLower]}`;
  }

  const sortedKeys = Object.keys(OPPONENT_NICKNAMES).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (displayLower === key || displayLower.startsWith(key + ' ')) {
      return `${displayName} ${OPPONENT_NICKNAMES[key]}`;
    }
  }

  return displayName;
}

// Convert ISO date "2026-02-20" → "Feb 20"
function formatDateFromISO(isoDate) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = isoDate.split('-').map(Number);
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return isoDate;
  return `${MONTHS[month - 1]} ${day}`;
}

function buildQuestion(sportSlug, opponent, isoDate) {
  const sportLabel = SPORT_LABELS[sportSlug] || sportSlug;
  const opponentDisplay = getOpponentWithNickname(opponent);
  const dateShort = formatDateFromISO(isoDate);
  return `Will Cornell ${sportLabel} beat the ${opponentDisplay} on ${dateShort}?`;
}

function buildResolutionRules(sportSlug, opponent, isoDate) {
  const sportLabel = SPORT_LABELS[sportSlug] || sportSlug;
  const opponentShort = cleanDisplayName(stripRanking(opponent));
  const dateShort = formatDateFromISO(isoDate);
  return `Resolves YES if Cornell wins the ${sportLabel} game vs ${opponentShort} on ${dateShort}. Resolves NO if Cornell loses. Resolves N/A if cancelled/postponed.`;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('\nFetching sports markets from Firestore...');
  const snapshot = await db.collection('markets').where('_sport', '!=', null).get();

  if (snapshot.empty) {
    console.log('No sports markets found (no documents with _sport field).');
    process.exit(0);
  }

  // Build update list
  const updates = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const sportSlug = data._sport;
    const opponent = data._opponent;
    const isoDate = data._gameDate;

    if (!sportSlug || !opponent || !isoDate) {
      console.warn(`  ⚠️  Skipping ${doc.id}: missing _sport, _opponent, or _gameDate`);
      continue;
    }

    const newQuestion = buildQuestion(sportSlug, opponent, isoDate);
    const newResolutionRules = buildResolutionRules(sportSlug, opponent, isoDate);

    updates.push({
      id: doc.id,
      oldQuestion: data.question,
      newQuestion,
      newResolutionRules,
    });
  }

  console.log(`\nFound ${updates.length} sports market(s) to update.\n`);

  // Show diff preview
  updates.forEach((u, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. OLD: ${u.oldQuestion}`);
    console.log(`      NEW: ${u.newQuestion}`);
    console.log('');
  });

  if (dryRun) {
    console.log('[DRY RUN] No writes made. Remove --dry-run to apply changes.');
    process.exit(0);
  }

  console.log('⚠️  This will update question and resolutionRules in your live Firestore database.');
  const answer = await prompt(`Type "UPDATE" to apply ${updates.length} changes, or anything else to cancel: `);
  if (answer !== 'UPDATE') {
    console.log('❌ Cancelled.');
    process.exit(0);
  }

  // Batch write (Firestore limit: 500 ops per batch)
  const BATCH_SIZE = 490;
  let updated = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(u => {
      batch.update(db.collection('markets').doc(u.id), {
        question: u.newQuestion,
        resolutionRules: u.newResolutionRules,
      });
    });
    await batch.commit();
    updated += chunk.length;
    console.log(`  ✅ Committed batch of ${chunk.length}`);
  }

  console.log(`\n🎉 Done! Updated ${updated} market(s).`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
