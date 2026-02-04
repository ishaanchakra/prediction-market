'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Add your email here to grant admin access
const ADMIN_EMAILS = ['ichakravorty14@gmail.com'];

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      // Check if user is admin
      if (!ADMIN_EMAILS.includes(currentUser.email)) {
        alert('Access denied. Admin only.');
        router.push('/');
        return;
      }

      setUser(currentUser);
      await fetchUnresolvedMarkets();
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function fetchUnresolvedMarkets() {
    try {
      const q = query(
        collection(db, 'markets'),
        where('resolution', '==', null)
      );
      const snapshot = await getDocs(q);
      const marketData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMarkets(marketData);
    } catch (error) {
      console.error('Error fetching markets:', error);
    }
  }

  async function handleResolve(marketId, resolution) {
    if (!confirm(`Are you sure you want to resolve this market as ${resolution}?`)) {
      return;
    }

    setResolving(marketId);
    try {
      // Fetch all bets for this market
      const betsQuery = query(
        collection(db, 'bets'),
        where('marketId', '==', marketId)
      );
      const betsSnapshot = await getDocs(betsQuery);
      
      // Calculate payouts
      const batch = writeBatch(db);
      const userPayouts = {}; // Track total payout per user

      betsSnapshot.docs.forEach(betDoc => {
        const bet = betDoc.data();
        
        // Winners get 1 rep per share, losers get 0
        if (bet.side === resolution) {
          const payout = bet.shares;
          if (!userPayouts[bet.userId]) {
            userPayouts[bet.userId] = 0;
          }
          userPayouts[bet.userId] += payout;
        }
      });

      // Update user balances
      for (const [userId, payout] of Object.entries(userPayouts)) {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          batch.update(userRef, {
            weeklyRep: userData.weeklyRep + payout,
            lifetimeRep: userData.lifetimeRep + payout
          });
        }
      }

      // Mark market as resolved
      batch.update(doc(db, 'markets', marketId), {
        resolution: resolution,
        resolvedAt: new Date()
      });

      await batch.commit();

      alert(`Market resolved as ${resolution}! Payouts distributed.`);
      await fetchUnresolvedMarkets();
    } catch (error) {
      console.error('Error resolving market:', error);
      alert('Error resolving market. Check console.');
    } finally {
      setResolving(null);
    }
  }

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) return <div className="p-8">Access denied</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Admin Panel</h1>
      
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">
          ⚠️ <strong>Admin Mode:</strong> Resolving a market is permanent and distributes payouts immediately.
        </p>
      </div>

      <h2 className="text-xl font-semibold mb-4">Unresolved Markets ({markets.length})</h2>

      {markets.length === 0 ? (
        <p className="text-gray-500">No unresolved markets. <Link href="/" className="text-indigo-600 hover:underline">View all markets</Link></p>
      ) : (
        <div className="space-y-4">
          {markets.map(market => (
            <div key={market.id} className="bg-white border rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-2">{market.question}</h3>
              <p className="text-sm text-gray-600 mb-4">
                Current probability: {Math.round(market.probability * 100)}%
              </p>
              
              <div className="flex gap-3">
                <button
                  onClick={() => handleResolve(market.id, 'YES')}
                  disabled={resolving === market.id}
                  className="flex-1 bg-green-500 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {resolving === market.id ? 'Resolving...' : 'Resolve as YES'}
                </button>
                
                <button
                  onClick={() => handleResolve(market.id, 'NO')}
                  disabled={resolving === market.id}
                  className="flex-1 bg-red-500 text-white py-2 px-4 rounded-lg font-semibold hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {resolving === market.id ? 'Resolving...' : 'Resolve as NO'}
                </button>
              </div>

              <Link 
                href={`/market/${market.id}`}
                className="block mt-3 text-sm text-indigo-600 hover:underline text-center"
              >
                View market details →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}