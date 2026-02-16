/**
 * Auto-categorizes a market question based on keyword matching.
 * Returns one of: 'sports' | 'campus' | 'academic' | 'admin' | 'wildcard'
 */

const CATEGORY_RULES = [
  {
    category: 'sports',
    keywords: [
      'hockey', 'basketball', 'football', 'lacrosse', 'baseball', 'soccer',
      'rowing', 'tennis', 'wrestling', 'swim', 'track', 'cross country',
      'volleyball', 'softball', 'golf', 'fencing', 'polo', 'squash',
      'beat', 'win', 'lose', 'game', 'match', 'tournament', 'playoff',
      'ecac', 'ivy league', 'ncaa', 'championship', 'frozen four',
      'big red', 'cornell athletics', 'lynah', 'olympic', 'medal',
      'season', 'finals', 'bowl', 'conference', 'varsity'
    ]
  },
  {
    category: 'campus',
    keywords: [
      'slope day', 'dragon day', 'slope', 'ho plaza', 'willard straight',
      'dining', 'rpcc', 'okenshields', 'north star', 'becker', 'mac',
      'arts quad', 'engineering quad', 'ag quad',
      'dorm', 'housing', 'west campus', 'north campus', 'program house',
      'event', 'concert', 'performer', 'headliner', 'show', 'speaker',
      'construction', 'building', 'renovation', 'flood', 'flooding',
      'party', 'festival', 'carnival', 'gorge', 'suspension bridge',
      'bus', 'tcat', 'transportation', 'ithaca', 'cayuga',
      'club', 'organization', 'greek', 'fraternity', 'sorority',
      'recruitment', 'rush'
    ]
  },
  {
    category: 'academic',
    keywords: [
      'class', 'course', 'professor', 'prof', 'prelim', 'final', 'exam',
      'grade', 'gpa', 'curve', 'median', 'roster', 'enrollment',
      'major', 'minor', 'degree', 'graduation', 'graduate', 'phd',
      'research', 'study', 'paper', 'publish', 'department',
      'college of', 'arts and sciences', 'engineering', 'dyson', 'ilr',
      'architecture', 'hotel', 'vet', 'law school', 'med school',
      'cs', 'infosci', 'econ', 'bio', 'chem', 'physics',
      'dean', 'faculty', 'tenure', 'fellowship', 'scholarship',
      'tuition', 'financial aid', 'cornell store'
    ]
  },
  {
    category: 'admin',
    keywords: [
      'president', 'provost', 'board of trustees', 'administration',
      'policy', 'code of conduct', 'student assembly', 'gpsa',
      'university assembly', 'faculty senate', 'resolution',
      'protest', 'rally', 'demonstration', 'ban', 'suspend', 'expel',
      'investigation', 'lawsuit', 'federal', 'government', 'ice',
      'immigration', 'dei', 'diversity', 'equity', 'inclusion',
      'institutional', 'statement', 'vote', 'election', 'referendum',
      'endowment', 'divestment', 'divest', 'hire', 'fire', 'resign',
      'lombardi', 'free speech', 'fire ranking', 'tcat', 'permit',
      'terawulf', 'data center', 'cayuga lake'
    ]
  }
];

export function categorizeMarket(question) {
  if (!question || typeof question !== 'string') return 'wildcard';

  const lower = question.toLowerCase();

  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      if (lower.includes(keyword)) {
        return rule.category;
      }
    }
  }

  return 'wildcard';
}

export const CATEGORIES = [
  { id: 'all', label: 'All Markets', emoji: '📊' },
  { id: 'sports', label: 'Sports', emoji: '🏒' },
  { id: 'campus', label: 'Campus Life', emoji: '🎓' },
  { id: 'academic', label: 'Academics', emoji: '📚' },
  { id: 'admin', label: 'Admin & Policy', emoji: '🏛️' },
  { id: 'wildcard', label: 'Wildcard', emoji: '🎲' },
];
