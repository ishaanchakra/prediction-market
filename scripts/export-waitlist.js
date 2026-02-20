// scripts/export-waitlist.js
// Exports all waitlist email sign-ups to stdout (copy into Mailchimp, Gmail, etc.)
//
// Run with: node scripts/export-waitlist.js
// Options:
//   --csv       Output as CSV with timestamp column (default: one email per line)
//   --count     Print count only

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const isCsv = process.argv.includes('--csv');
const countOnly = process.argv.includes('--count');

async function exportWaitlist() {
  const snap = await db.collection('waitlist').orderBy('submittedAt', 'asc').get();

  if (snap.empty) {
    console.log('No waitlist entries found.');
    return;
  }

  if (countOnly) {
    console.log(`${snap.size} email${snap.size === 1 ? '' : 's'} on the waitlist.`);
    return;
  }

  const entries = snap.docs.map((d) => {
    const data = d.data();
    const ts = data.submittedAt?.toDate?.()?.toISOString?.() ?? '';
    return { email: data.email || d.id, ts };
  });

  if (isCsv) {
    console.log('email,submitted_at');
    for (const { email, ts } of entries) {
      console.log(`${email},${ts}`);
    }
  } else {
    for (const { email } of entries) {
      console.log(email);
    }
  }

  console.error(`\n(${entries.length} total)`); // stderr so it doesn't pollute pipe output
}

exportWaitlist()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
