'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import { getPublicDisplayName } from '@/utils/displayName';

function round2(num) {
  return Math.round(num * 100) / 100;
}

export default function LeaderboardPage() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setViewer(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const q = query(collection(db, 'users'), orderBy('lifetimeRep', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        const userData = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data()
        }));
        setUsers(userData);
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, []);

  if (loading) return <div className="p-8 bg-brand-red text-white min-h-screen">Loading...</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto bg-brand-red min-h-screen">
      <h1 className="text-3xl font-bold mb-2 text-white">Leaderboard</h1>
      <p className="text-white opacity-90 mb-8">Top predictors ranked by lifetime earnings</p>

      <div className="bg-white rounded-lg border-2 border-brand-pink overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rank</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Balance</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Lifetime Earnings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {users.map((user, index) => (
              <tr
                key={user.id}
                onClick={() => router.push(`/user/${user.id}`)}
                className={`cursor-pointer ${index < 3 ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    {index === 0 && <span className="text-2xl mr-2">🥇</span>}
                    {index === 1 && <span className="text-2xl mr-2">🥈</span>}
                    {index === 2 && <span className="text-2xl mr-2">🥉</span>}
                    <span className="text-sm font-medium text-gray-900">#{index + 1}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{getPublicDisplayName(user)}</div>
                  {viewer && user.email && (
                    <div className="text-xs text-gray-500">
                      {user.email}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <span className="text-sm font-semibold text-gray-900">${round2(user.weeklyRep || 0)}</span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right">
                  <span className="text-sm font-bold text-brand-red">${round2(user.lifetimeRep || 0)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="text-center py-12 text-gray-500">No users yet. Be the first!</div>
        )}
      </div>
    </div>
  );
}
