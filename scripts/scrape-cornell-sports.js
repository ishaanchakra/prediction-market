// scripts/scrape-cornell-sports.js
// Scrapes upcoming Cornell Big Red games from cornellbigred.com
// Run: npm install --save-dev cheerio   (one-time)
//       node scripts/scrape-cornell-sports.js

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

let cheerio;
try {
  cheerio = require('cheerio');
} catch {
  console.error('❌ cheerio not installed. Run: npm install --save-dev cheerio');
  process.exit(1);
}

// Major Cornell sports — slugs must match cornellbigred.com/sports/{slug}/schedule
const SPORTS = [
  { slug: 'mens-basketball',    name: "Men's Basketball" },
  { slug: 'womens-basketball',  name: "Women's Basketball" },
  { slug: 'mens-ice-hockey',    name: "Men's Ice Hockey" },
  { slug: 'womens-ice-hockey',  name: "Women's Ice Hockey" },
  { slug: 'wrestling',          name: "Wrestling" },
  { slug: 'mens-lacrosse',      name: "Men's Lacrosse" },
  { slug: 'womens-lacrosse',    name: "Women's Lacrosse" },
  { slug: 'baseball',           name: "Baseball" },
  { slug: 'softball',           name: "Softball" },
];

function fetchPage(url, redirectCount) {
  if (!redirectCount) redirectCount = 0;
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
  var lib = url.startsWith('https') ? https : http;
  return new Promise(function(resolve, reject) {
    var req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      }
    }, function(res) {
      if ([301, 302, 307].includes(res.statusCode)) {
        var location = res.headers.location;
        var redirectUrl = location.startsWith('http') ? location : new URL(location, url).href;
        res.resume();
        return fetchPage(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve(data); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Parse Sidearm date text like "Feb 21 (Sat)" — no year on page, infer from context
function parseSidearmDate(text) {
  // Grab first "Mon DD" or "Mon D" group from text like "Feb 21 (Sat) 2:00 p.m."
  var match = text.match(/([A-Z][a-z]+)\s+(\d{1,2})/);
  if (!match) return null;
  var month = match[1];
  var day = parseInt(match[2], 10);
  var now = new Date();
  now.setHours(0, 0, 0, 0);

  // Try current year; if the result is in the past, try next year
  for (var offset = 0; offset <= 1; offset++) {
    var year = now.getFullYear() + offset;
    var d = new Date(month + ' ' + day + ', ' + year);
    if (!isNaN(d.getTime()) && d >= now) return d;
  }
  return null;
}

function formatDateText(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

function parseGames(html, sport) {
  var $ = cheerio.load(html);
  var games = [];

  // Only select games that haven't been played yet
  // Sidearm marks upcoming games with 'sidearm-schedule-game-upcoming'
  // and completed games with 'sidearm-schedule-game-completed'
  var $games = $('.sidearm-schedule-game-upcoming');

  // Fallback: any game li without 'sidearm-schedule-game-completed'
  if ($games.length === 0) {
    $games = $('.sidearm-schedule-game').filter(function(_, el) {
      return !($(el).attr('class') || '').includes('sidearm-schedule-game-completed');
    });
  }

  $games.each(function(_, el) {
    var $el = $(el);

    // ---- DATE ----
    var dateText = $el.find('.sidearm-schedule-game-opponent-date').text().replace(/\s+/g, ' ').trim();
    var gameDate = parseSidearmDate(dateText);
    if (!gameDate) return; // Skip if we can't parse the date

    // ---- OPPONENT ----
    var opponent = $el.find('.sidearm-schedule-game-opponent-name').text().replace(/\s+/g, ' ').trim();
    if (!opponent) return;
    // Remove any trailing record like " (12-5)"
    opponent = opponent.replace(/\s*\(\d+-\d+\).*$/, '').trim();

    // ---- HOME / AWAY ----
    // The <li> itself carries sidearm-schedule-home-game or sidearm-schedule-away-game
    var liClass = $el.attr('class') || '';
    var homeAway = liClass.includes('sidearm-schedule-away-game') ? 'away' : 'home';

    // ---- LOCATION ----
    var location = $el.find('.sidearm-schedule-game-location').text().replace(/\s+/g, ' ').trim();

    // ---- SKIP TOURNAMENT / TBD opponents ----
    var opLower = opponent.toLowerCase();
    var isTournament = opLower.includes('tournament') || opLower.includes('tbd') || opLower.includes('tba') || opponent === '';

    games.push({
      sport: sport.slug,
      sportName: sport.name,
      opponent: opponent,
      date: gameDate.toISOString().split('T')[0],
      dateText: formatDateText(gameDate),
      homeAway: homeAway,
      location: location || (homeAway === 'home' ? 'Ithaca, NY' : ''),
      isTournament: isTournament,
    });
  });

  return games;
}

async function scrapeAllSports() {
  var allGames = [];
  var errors = [];

  for (var i = 0; i < SPORTS.length; i++) {
    var sport = SPORTS[i];
    var url = 'https://cornellbigred.com/sports/' + sport.slug + '/schedule';
    process.stdout.write('  Fetching ' + sport.name.padEnd(24) + ' ');

    try {
      var html = await fetchPage(url);
      var games = parseGames(html, sport);
      if (games.length === 0) {
        console.log('(no upcoming games found)');
      } else {
        console.log('→ ' + games.length + ' upcoming game' + (games.length === 1 ? '' : 's'));
        allGames = allGames.concat(games);
      }
    } catch (err) {
      console.log('FAILED: ' + err.message);
      errors.push({ sport: sport.name, error: err.message });
    }
  }

  // Sort chronologically
  allGames.sort(function(a, b) { return a.date.localeCompare(b.date); });

  var outPath = path.join(__dirname, 'cornell-games.json');
  fs.writeFileSync(outPath, JSON.stringify(allGames, null, 2));

  console.log('\n✅ Scraped ' + allGames.length + ' upcoming games → scripts/cornell-games.json');

  if (allGames.length > 0) {
    console.log('\n--- All upcoming games ---');
    allGames.forEach(function(g, i) {
      var loc = g.homeAway === 'away' ? 'at ' + g.opponent : 'vs. ' + g.opponent;
      var flag = g.isTournament ? ' [TOURNAMENT]' : '';
      console.log('  ' + String(i + 1).padStart(2) + '. [' + g.sportName + '] ' + loc + ' — ' + g.dateText + flag);
    });
  }

  if (errors.length > 0) {
    console.log('\n⚠️  Fetch errors:');
    errors.forEach(function(e) { console.log('   - ' + e.sport + ': ' + e.error); });
  }

  console.log('\nNext step: review the JSON, then run:');
  console.log('  node scripts/bulk-create-markets.js --dry-run');
  console.log('  node scripts/bulk-create-markets.js');
}

console.log('🔍 Scraping Cornell Big Red upcoming schedules...\n');
scrapeAllSports().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
