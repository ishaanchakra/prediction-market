'use client';
import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs, writeBatch, doc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { getPublicDisplayName } from '@/utils/displayName';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

function fmtMoney(value) {
  return Number(value || 0).toFixed(2);
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(null);
  const [resetting, setResetting] = useState(false);

  const isAdmin = useMemo(() => !!viewer?.email && ADMIN_EMAILS.includes(viewer.email), [viewer]);

  const weeklyUsers = useMemo(
    () => [...users].sort((a, b) => Number(b.weeklyRep || 0) - Number(a.weeklyRep || 0)).slice(0, 50),
    [users]
  );

  const lifetimeUsers = useMemo(
    () => [...users].sort((a, b) => Number(b.lifetimeRep || 0) - Number(a.lifetimeRep || 0)).slice(0, 50),
    [users]
  );

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setViewer(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const q = query(collection(db, 'users'), orderBy('lifetimeRep', 'desc'), limit(200));
        const snapshot = await getDocs(q);
        setUsers(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, []);

  async function handleWeeklyReset() {
    if (!isAdmin) return;
    if (!confirm('Reset weekly leaderboard now? This sets all weekly balances to $1000.00.')) {
      return;
    }

    setResetting(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((snapshotDoc) => {
        batch.update(doc(db, 'users', snapshotDoc.id), { weeklyRep: 1000 });
      });
      await batch.commit();

      setUsers((prev) => prev.map((user) => ({ ...user, weeklyRep: 1000 })));
      alert('Weekly leaderboard reset complete.');
    } catch (error) {
      console.error('Error resetting weekly leaderboard:', error);
      alert('Failed to reset weekly leaderboard.');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <div className="p-8 bg-brand-red dark:bg-slate-950 text-white min-h-screen">Loading...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto bg-brand-red dark:bg-slate-950 min-h-screen">
      <h1 className="text-3xl font-bold mb-2 text-white">Leaderboard</h1>
      <p className="text-white opacity-90 mb-6">Weekly race on top, all-time standings below.</p>

      <LeaderboardTable
        title="Weekly Rankings"
        subtitle="Traders of the week"
        users={weeklyUsers}
        isAdmin={isAdmin}
        router={router}
        metricLabel="Net Profit (Week)"
        metricFn={(user) => Number(user.weeklyRep || 0) - 1000}
      />

      {isAdmin && (
        <div className="mt-4 mb-8">
          <button
            onClick={handleWeeklyReset}
            disabled={resetting}
            className="bg-yellow-400 text-yellow-950 px-4 py-2 rounded-lg font-bold hover:bg-yellow-300 disabled:bg-gray-300"
          >
            {resetting ? 'Resetting...' : 'Admin: Weekly Reset'}
          </button>
        </div>
      )}

      <LeaderboardTable
        title="Lifetime Rankings"
        subtitle="The Oracles of Ithaca"
        users={lifetimeUsers}
        isAdmin={isAdmin}
        router={router}
        metricLabel="Net Profit (All-Time)"
        metricFn={(user) => Number(user.lifetimeRep || 0)}
        lifetime
      />
    </div>
  );
}

function LeaderboardTable({ title, subtitle, users, isAdmin, router, metricLabel, metricFn, lifetime = false }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border-2 border-brand-pink dark:border-slate-700 overflow-hidden mb-8">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">{subtitle}</p>
      </div>

      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Rank</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">User</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{metricLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {users.map((user, index) => (
            <tr
              key={user.id}
              onClick={() => router.push(`/user/${user.id}`)}
              className={`cursor-pointer ${index < 3 ? 'bg-yellow-50 dark:bg-slate-800' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}
            >
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center text-sm font-medium text-gray-900 dark:text-gray-100">
                  {index === 0 && <span className="text-2xl mr-2">{lifetime ? '🔮' : '🥇'}</span>}
                  {index === 1 && <span className="text-2xl mr-2">🥈</span>}
                  {index === 2 && <span className="text-2xl mr-2">🥉</span>}
                  {index > 2 && <span>{index + 1}</span>}
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{getPublicDisplayName(user)}</div>
                {isAdmin && user.email && <div className="text-xs text-gray-500 dark:text-gray-400">{user.email}</div>}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-right">
                <span className={`text-sm font-bold ${lifetime ? 'text-brand-red' : 'text-gray-900 dark:text-gray-100'}`}>
                  ${fmtMoney(metricFn(user))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {users.length === 0 && <div className="text-center py-12 text-gray-500 dark:text-gray-300">No users yet. Be the first!</div>}
    </div>
  );
}
