'use client';
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import Link from 'next/link';

function round2(num) {
  return Math.round(num * 100) / 100;
}

export default function UserProfilePage() {
  const { id } = useParams();
  const [user, setUser] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function fetchUserProfile() {
      try {
        const userDoc = await getDoc(doc(db, 'users', id));
        if (!userDoc.exists()) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setUser({ uid: id, ...userDoc.data() });

        const betsQuery = query(
          collection(db, 'bets'),
          where('userId', '==', id)
        );
        const betsSnapshot = await getDocs(betsQuery);

        const betsWithMarkets = await Promise.all(
          betsSnapshot.docs.map(async (betDoc) => {
            const betData = betDoc.data();
            try {
              const marketDoc = await getDoc(doc(db, 'markets', betData.marketId));
              return {
                id: betDoc.id,
                ...betData,
                marketQuestion: marketDoc.exists() ? marketDoc.data().question : 'Market not found'
              };
            } catch (error) {
              return {
                id: betDoc.id,
                ...betData,
                marketQuestion: 'Error loading market'
              };
            }
          })
        );

        setBets(betsWithMarkets);
      } catch (error) {
        console.error('Error fetching user profile:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchUserProfile();
  }, [id]);

  if (loading) return <div className="p-8 bg-brand-red text-white min-h-screen">Loading...</div>;
  if (notFound) return (
    <div className="p-8 max-w-4xl mx-auto bg-brand-red min-h-screen">
      <h1 className="text-3xl font-bold mb-2 text-white">User Not Found</h1>
      <p className="text-white opacity-90">This user does not exist.</p>
      <Link href="/leaderboard" className="text-white underline mt-4 inline-block">Back to Leaderboard</Link>
    </div>
  );
  if (!user) return null;

  const username = user.email?.split('@')[0] || 'Anonymous';

  return (
    <div className="p-8 max-w-4xl mx-auto bg-brand-red min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 text-white">{username}&apos;s Profile</h1>
        <p className="text-white opacity-90">{user.email}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gradient-to-br from-brand-red to-brand-darkred rounded-lg p-6 text-white border-2 border-white">
          <p className="text-sm opacity-90 mb-1">Weekly Rep</p>
          <p className="text-4xl font-bold">{round2(user.weeklyRep || 0)}</p>
          <p className="text-sm opacity-75 mt-2">Resets every Monday</p>
        </div>

        <div className="bg-gradient-to-br from-brand-pink to-brand-red rounded-lg p-6 text-white border-2 border-white">
          <p className="text-sm opacity-90 mb-1">Lifetime Rep</p>
          <p className="text-4xl font-bold">{round2(user.lifetimeRep || 0)}</p>
          <p className="text-sm opacity-75 mt-2">All-time earnings</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border-2 border-brand-pink p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900">Bets ({bets.length})</h2>

        {bets.length === 0 ? (
          <p className="text-gray-500">No bets yet.</p>
        ) : (
          <div className="space-y-3">
            {bets.map(bet => (
              <Link
                key={bet.id}
                href={`/market/${bet.marketId}`}
                className="block border-2 border-gray-200 rounded-lg p-4 hover:bg-gray-50 hover:border-brand-pink transition-colors"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    bet.side === 'YES' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {bet.side}
                  </span>
                  <span className="text-sm text-gray-500">
                    {bet.timestamp?.toDate?.()?.toLocaleDateString() || 'Recently'}
                  </span>
                </div>
                <p className="font-medium text-gray-900 mb-2">
                  {bet.marketQuestion || 'Loading...'}
                </p>
                <p className="text-gray-900 mb-1">Amount: <span className="font-semibold">{round2(bet.amount || 0)} rep</span></p>
                <p className="text-sm text-gray-600">Shares: {round2(bet.shares || 0)}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
