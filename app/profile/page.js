'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      try {
        // Fetch user data
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          setUser({ id: userDoc.id, ...userDoc.data() });
        }

        // Fetch user's bets
        const betsQuery = query(
          collection(db, 'bets'),
          where('userId', '==', currentUser.uid),
          orderBy('timestamp', 'desc')
        );
        const betsSnapshot = await getDocs(betsQuery);
        const betsData = await Promise.all(
            betsSnapshot.docs.map(async (betDoc) => {
              const betData = { id: betDoc.id, ...betDoc.data() };
              
              // Fetch the market for this bet
              try {
                const marketDoc = await getDoc(doc(db, 'markets', betData.marketId));
                if (marketDoc.exists()) {
                  betData.marketQuestion = marketDoc.data().question;
                }
              } catch (error) {
                console.error('Error fetching market:', error);
              }
              
              return betData;
            })
          );
          setBets(betsData);
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) return <div className="p-8">User not found</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Your Profile</h1>
        <p className="text-gray-600">{user.email}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg p-6 text-white">
          <p className="text-sm opacity-90 mb-1">Weekly Rep</p>
          <p className="text-4xl font-bold">{user.weeklyRep}</p>
          <p className="text-sm opacity-75 mt-2">Resets every Monday</p>
        </div>

        <div className="bg-gradient-to-br from-green-500 to-teal-600 rounded-lg p-6 text-white">
          <p className="text-sm opacity-90 mb-1">Lifetime Rep</p>
          <p className="text-4xl font-bold">{user.lifetimeRep}</p>
          <p className="text-sm opacity-75 mt-2">All-time earnings</p>
        </div>
      </div>

      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-xl font-semibold mb-4">Your Bets ({bets.length})</h2>
        
        {bets.length === 0 ? (
          <p className="text-gray-500">No bets yet. <Link href="/" className="text-indigo-600 hover:underline">Browse markets</Link></p>
        ) : (
          <div className="space-y-3">
            {bets.map(bet => (
  <Link 
    key={bet.id} 
    href={`/market/${bet.marketId}`}
    className="block border rounded-lg p-4 hover:bg-gray-50 transition-colors"
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
    <p className="text-gray-900 mb-1">Amount: <span className="font-semibold">{bet.amount} rep</span></p>
    <p className="text-sm text-gray-600">Shares: {bet.shares.toFixed(2)}</p>
  </Link>
))}
          </div>
        )}
      </div>
    </div>
  );
}