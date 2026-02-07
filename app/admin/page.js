'use client';
import { useEffect, useState } from 'react';
<<<<<<< HEAD
import { auth, db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, writeBatch, addDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newMarketQuestion, setNewMarketQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [initialProbability, setInitialProbability] = useState(50);
  const [liquidityAmount, setLiquidityAmount] = useState(1000);
  const router = useRouter();
=======
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import Link from 'next/link';

export default function Home() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7

  useEffect(() => {
    async function fetchMarkets() {
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
      } finally {
        setLoading(false);
      }
<<<<<<< HEAD

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

  async function handleCreateMarket() {
    if (!newMarketQuestion.trim()) {
      alert('Please enter a question');
      return;
    }

    if (initialProbability < 1 || initialProbability > 99) {
      alert('Probability must be between 1% and 99%');
      return;
    }

    setCreating(true);
    try {
      const probDecimal = initialProbability / 100;
      const yesPool = liquidityAmount * probDecimal / (1 - probDecimal);
      const noPool = liquidityAmount;

      await addDoc(collection(db, 'markets'), {
        question: newMarketQuestion.trim(),
        probability: probDecimal,
        liquidityPool: {
          yes: yesPool,
          no: noPool
        },
        resolution: null,
        createdAt: new Date()
      });

      alert('Market created successfully!');
      setNewMarketQuestion('');
      setInitialProbability(50);
      setLiquidityAmount(1000);
      setShowCreateForm(false);
      await fetchUnresolvedMarkets();
    } catch (error) {
      console.error('Error creating market:', error);
      alert('Error creating market. Check console.');
    } finally {
      setCreating(false);
    }
  }

  async function handleResolve(marketId, resolution) {
    if (!confirm(`Are you sure you want to resolve this market as ${resolution}?`)) {
      return;
    }

    setResolving(marketId);
    try {
      const betsQuery = query(
        collection(db, 'bets'),
        where('marketId', '==', marketId)
      );
      const betsSnapshot = await getDocs(betsQuery);
      
      const batch = writeBatch(db);
      const userPayouts = {};

      betsSnapshot.docs.forEach(betDoc => {
        const bet = betDoc.data();
        if (bet.side === resolution) {
          const payout = bet.shares;
          if (!userPayouts[bet.userId]) {
            userPayouts[bet.userId] = 0;
          }
          userPayouts[bet.userId] += payout;
        }
      });

      const marketDoc = await getDoc(doc(db, 'markets', marketId));
      const marketQuestion = marketDoc.data().question;

      for (const [userId, payout] of Object.entries(userPayouts)) {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.data();
          batch.update(userRef, {
            weeklyRep: userData.weeklyRep + payout,
            lifetimeRep: userData.lifetimeRep + payout
          });

          const notificationRef = doc(collection(db, 'notifications'));
          batch.set(notificationRef, {
            userId: userId,
            type: 'payout',
            marketId: marketId,
            marketQuestion: marketQuestion,
            amount: Math.round(payout),
            resolution: resolution,
            read: false,
            createdAt: new Date()
          });
        }
      }

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
=======
    }
    fetchMarkets();
  }, []);
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7

  if (loading) return <div className="p-8">Loading...</div>;

  return (
<<<<<<< HEAD
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Admin Panel</h1>
      
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">
          ⚠️ <strong>Admin Mode:</strong> Resolving a market is permanent and distributes payouts immediately.
        </p>
      </div>

      <div className="mb-8">
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
          >
            + Create New Market
          </button>
        ) : (
          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Create New Market</h2>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Market Question
              </label>
              <input
                type="text"
                value={newMarketQuestion}
                onChange={(e) => setNewMarketQuestion(e.target.value)}
                placeholder="e.g., Will it snow in Ithaca this week?"
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Initial Probability (%)
                </label>
                <input
                  type="number"
                  value={initialProbability}
                  onChange={(e) => setInitialProbability(Number(e.target.value))}
                  min="1"
                  max="99"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Default: 50% (no opinion)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Liquidity Depth
                </label>
                <input
                  type="number"
                  value={liquidityAmount}
                  onChange={(e) => setLiquidityAmount(Number(e.target.value))}
                  min="100"
                  max="10000"
                  step="100"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Higher = less price impact
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-500 mb-4">
              Preview: YES pool ≈ {Math.round(liquidityAmount * (initialProbability/100) / (1 - initialProbability/100))}, 
              NO pool = {liquidityAmount}
            </p>

            <div className="flex gap-3">
              <button
                onClick={handleCreateMarket}
                disabled={creating || !newMarketQuestion.trim()}
                className="flex-1 bg-green-500 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating...' : 'Create Market'}
              </button>
              
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewMarketQuestion('');
                  setInitialProbability(50);
                  setLiquidityAmount(1000);
                }}
                disabled={creating}
                className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-semibold hover:bg-gray-300 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
=======
    <div className="min-h-screen bg-eggshell">
      <div className="max-w-6xl mx-auto p-8">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-carnelian mb-2">
            Cornell Prediction Markets
          </h1>
          <p className="text-gray-600">
            Forecast campus events. Build your reputation. Prove you know what's coming.
          </p>
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7
        </div>

        {markets.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No active markets yet. Check back soon!</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {markets.map((market) => (
              <Link
                key={market.id}
                href={`/market/${market.id}`}
                className="block group"
              >
                <div className="bg-cream rounded-lg border-2 border-carnelian hover:shadow-xl transition-all duration-200 overflow-hidden h-full">
                  <div className="p-6">
                    <h2 className="text-lg font-semibold text-gray-900 group-hover:text-carnelian transition-colors mb-4 min-h-[60px]">
                      {market.question}
                    </h2>

                    <div className="mt-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-600">Probability</span>
                        <span className="text-3xl font-bold text-carnelian">
                          {typeof market.probability === 'number' 
                            ? `${Math.round(market.probability * 100)}%` 
                            : 'N/A'}
                        </span>
                      </div>

                      {typeof market.probability === 'number' && (
                        <div className="mt-3">
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            <div 
                              className="bg-carnelian h-3 rounded-full transition-all duration-300"
                              style={{ width: `${market.probability * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex items-center text-sm text-carnelian font-medium">
                      <span className="group-hover:underline">View market →</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}