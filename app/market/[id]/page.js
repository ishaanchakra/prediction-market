'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { calculateBet } from '@/utils/amm';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Utility function for rounding to 2 decimals
function round2(num) {
  return Math.round(num * 100) / 100;
}

export default function MarketPage() {
  const params = useParams();
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [betAmount, setBetAmount] = useState('');
  const [selectedSide, setSelectedSide] = useState('YES');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [betHistory, setBetHistory] = useState([]);
  const [trades, setTrades] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchMarket() {
      try {
        const docRef = doc(db, 'markets', params.id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const marketData = { id: docSnap.id, ...docSnap.data() };
          setMarket(marketData);
        }
      } catch (error) {
        console.error('Error fetching market:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchMarket();
  }, [params.id]);

  // Fetch recent trades for live feed
  useEffect(() => {
    async function fetchTrades() {
      if (!params.id) return;
      
      try {
        const q = query(
          collection(db, 'bets'),
          where('marketId', '==', params.id),
          orderBy('timestamp', 'desc'),
          limit(20)
        );
        const snapshot = await getDocs(q);
        
        const tradesData = await Promise.all(
          snapshot.docs.map(async (betDoc) => {
            const bet = betDoc.data();
            try {
              const userDoc = await getDoc(doc(db, 'users', bet.userId));
              const userEmail = userDoc.exists() ? userDoc.data().email : 'Unknown';
              const netid = userEmail.split('@')[0];
              
              return {
                id: betDoc.id,
                netid,
                amount: round2(bet.amount),
                side: bet.side,
                oldProbability: bet.oldProbability,
                newProbability: bet.probability,
                timestamp: bet.timestamp?.toDate?.() || new Date()
              };
            } catch (err) {
              console.error('Error fetching user:', err);
              return null;
            }
          })
        );
        
        setTrades(tradesData.filter(t => t !== null));
      } catch (error) {
        console.error('Error fetching trades:', error);
      }
    }
    
    if (market) {
      fetchTrades();
    }
  }, [market, params.id]);

  useEffect(() => {
    async function fetchBetHistory() {
      if (!params.id) return;
      
      try {
        const q = query(
          collection(db, 'bets'),
          where('marketId', '==', params.id),
          orderBy('timestamp', 'asc')
        );
        const snapshot = await getDocs(q);
        
        const history = [{
          timestamp: market?.createdAt?.toDate?.() || new Date(),
          probability: market?.probability || 0.5
        }];
        
        snapshot.docs.forEach(doc => {
          const bet = doc.data();
          history.push({
            timestamp: bet.timestamp?.toDate?.() || new Date(),
            probability: bet.probability
          });
        });
        
        setBetHistory(history);
      } catch (error) {
        console.error('Error fetching bet history:', error);
      }
    }
    
    if (market) {
      fetchBetHistory();
    }
  }, [market, params.id]);

  useEffect(() => {
    if (market && betAmount && parseFloat(betAmount) > 0 && currentUser) {
      try {
        const result = calculateBet(market.liquidityPool, parseFloat(betAmount), selectedSide);
        setPreview(result);
      } catch (error) {
        setPreview(null);
      }
    } else {
      setPreview(null);
    }
  }, [betAmount, selectedSide, market, currentUser]);

  async function handlePlaceBet() {
    if (!currentUser) {
      if (confirm('You need to sign in to place bets. Go to login page?')) {
        window.location.href = '/login';
      }
      return;
    }

    if (!betAmount || parseFloat(betAmount) <= 0) {
      alert('Please enter a valid bet amount');
      return;
    }

    setSubmitting(true);
    try {
      const amount = round2(parseFloat(betAmount));
      
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (!userDoc.exists()) {
        alert('User profile not found. Please log out and log back in.');
        return;
      }
      
      const userData = userDoc.data();
      if (userData.weeklyRep < amount) {
        alert(`Insufficient rep! You have ${round2(userData.weeklyRep)} rep available.`);
        setSubmitting(false);
        return;
      }

      const oldProbability = market.probability;
      const result = calculateBet(market.liquidityPool, amount, selectedSide);
      
      // Round all values to 2 decimals
      const roundedShares = round2(result.shares);
      const roundedNewProbability = round2(result.newProbability * 100) / 100; // Keep probability as decimal
      const roundedNewYes = round2(result.newPool.yes);
      const roundedNewNo = round2(result.newPool.no);
      const newWeeklyRep = round2(userData.weeklyRep - amount);
      
      const totalLiquidity = market.liquidityPool.yes + market.liquidityPool.no;
      const isSignificantTrade = amount >= (totalLiquidity * 0.10); // 10% threshold
      
      // Create the bet with rounded values
      await addDoc(collection(db, 'bets'), {
        userId: currentUser.uid,
        marketId: params.id,
        side: selectedSide,
        amount: amount,
        shares: roundedShares,
        oldProbability: oldProbability,
        probability: roundedNewProbability,
        timestamp: new Date()
      });

      // Update market with rounded liquidity
      await updateDoc(doc(db, 'markets', params.id), {
        liquidityPool: {
          yes: roundedNewYes,
          no: roundedNewNo
        },
        probability: roundedNewProbability
      });

      // Update user rep with rounded value
      await updateDoc(doc(db, 'users', currentUser.uid), {
        weeklyRep: newWeeklyRep
      });

      // If significant trade, notify other users invested in this market
      if (isSignificantTrade) {
        try {
          const betsQuery = query(
            collection(db, 'bets'),
            where('marketId', '==', params.id)
          );
          const betsSnapshot = await getDocs(betsQuery);
          
          const investedUserIds = new Set();
          betsSnapshot.docs.forEach(doc => {
            const betData = doc.data();
            if (betData.userId !== currentUser.uid) {
              investedUserIds.add(betData.userId);
            }
          });

          const traderNetid = currentUser.email.split('@')[0];
          const probChange = ((roundedNewProbability - oldProbability) * 100).toFixed(1);
          const direction = probChange > 0 ? '+' : '';
          
          for (const userId of investedUserIds) {
            await addDoc(collection(db, 'notifications'), {
              userId: userId,
              type: 'significant_trade',
              marketId: params.id,
              marketQuestion: market.question,
              traderNetid: traderNetid,
              tradeAmount: amount,
              tradeSide: selectedSide,
              probabilityChange: `${direction}${probChange}%`,
              oldProbability: Math.round(oldProbability * 100),
              newProbability: Math.round(roundedNewProbability * 100),
              read: false,
              createdAt: new Date()
            });
          }
        } catch (notifError) {
          console.error('Error creating notifications:', notifError);
        }
      }

      // Refresh market data
      const docRef = doc(db, 'markets', params.id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setMarket({ id: docSnap.id, ...docSnap.data() });
      }

      // Refresh trades feed
      const tradesQuery = query(
        collection(db, 'bets'),
        where('marketId', '==', params.id),
        orderBy('timestamp', 'desc'),
        limit(20)
      );
      const tradesSnapshot = await getDocs(tradesQuery);
      const newTrades = await Promise.all(
        tradesSnapshot.docs.map(async (betDoc) => {
          const bet = betDoc.data();
          try {
            const userDocSnap = await getDoc(doc(db, 'users', bet.userId));
            const userEmail = userDocSnap.exists() ? userDocSnap.data().email : 'Unknown';
            const netid = userEmail.split('@')[0];
            
            return {
              id: betDoc.id,
              netid,
              amount: round2(bet.amount),
              side: bet.side,
              oldProbability: bet.oldProbability,
              newProbability: bet.probability,
              timestamp: bet.timestamp?.toDate?.() || new Date()
            };
          } catch (err) {
            return null;
          }
        })
      );
      setTrades(newTrades.filter(t => t !== null));

      setBetAmount('');
      setPreview(null);
      alert(`Bet placed! You have ${newWeeklyRep} rep remaining.`);
    } catch (error) {
      console.error('Error placing bet:', error);
      alert('Error placing bet. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-8 bg-brand-red text-white min-h-screen">Loading...</div>;
  if (!market) return <div className="p-8 bg-brand-red text-white min-h-screen">Market not found</div>;

  const isResolved = market.resolution !== null;

  return (
    <div className="p-8 max-w-6xl mx-auto bg-brand-red min-h-screen">
      <Link href="/" className="text-white hover:text-brand-lightpink mb-4 inline-block">
        ← Back to markets
      </Link>
      
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main content - 2 columns */}
        <div className="lg:col-span-2 space-y-6">
          <h1 className="text-3xl font-bold text-white">{market.question}</h1>
          
          <div className="bg-white rounded-lg p-6">
            <p className="text-5xl font-bold text-brand-red text-center">
              {typeof market.probability === 'number'
                ? `${Math.round(market.probability * 100)}%`
                : 'N/A'}
            </p>
            <p className="text-center text-gray-600 mt-2">Current Probability</p>
          </div>

          {betHistory.length > 1 && (
            <div className="bg-white rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Probability History</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={betHistory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(timestamp) => {
                      const date = new Date(timestamp);
                      return `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
                    }}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis 
                    domain={['dataMin - 0.1', 'dataMax + 0.1']}
                    tickFormatter={(value) => `${Math.round(value * 100)}%`}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    formatter={(value) => `${Math.round(value * 100)}%`}
                    labelFormatter={(timestamp) => {
                      const date = new Date(timestamp);
                      return date.toLocaleString();
                    }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="probability" 
                    stroke="#DC2626" 
                    strokeWidth={2}
                    dot={{ fill: '#DC2626', r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="bg-white rounded-lg p-6">
            {isResolved ? (
              <div className="text-center py-8">
                <div className="text-5xl mb-4">
                  {market.resolution === 'YES' ? '✅' : '❌'}
                </div>
                <h2 className="text-2xl font-bold mb-2">
                  Market Resolved: {market.resolution}
                </h2>
                <p className="text-gray-600">
                  This market is closed for betting.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-semibold mb-4">Place a Bet</h2>
                
                {!currentUser && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-yellow-800">
                      🔒 You must be signed in to place bets. <Link href="/login" className="underline font-semibold">Sign in here</Link>
                    </p>
                  </div>
                )}
                
                <div className="flex gap-4 mb-4">
                  <button
                    onClick={() => {
                      if (!currentUser) {
                        if (confirm('You need to sign in to place bets. Go to login page?')) {
                          window.location.href = '/login';
                        }
                        return;
                      }
                      setSelectedSide('YES');
                    }}
                    className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${
                      selectedSide === 'YES'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    YES
                  </button>
                  <button
                    onClick={() => {
                      if (!currentUser) {
                        if (confirm('You need to sign in to place bets. Go to login page?')) {
                          window.location.href = '/login';
                        }
                        return;
                      }
                      setSelectedSide('NO');
                    }}
                    className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${
                      selectedSide === 'NO'
                        ? 'bg-red-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    NO
                  </button>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Bet Amount (rep)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    placeholder={currentUser ? "Enter amount" : "Sign in to place bets"}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-brand-red focus:border-transparent text-gray-900 placeholder-gray-400"
                    min="0.01"
                    disabled={!currentUser}
                  />
                </div>

                {preview && currentUser && (
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <p className="text-sm text-gray-700 mb-2">Preview:</p>
                    <p className="font-semibold text-gray-900">You'll receive: {round2(preview.shares)} shares</p>
                    <p className="text-sm text-gray-700">New probability: {Math.round(preview.newProbability * 100)}%</p>
                  </div>
                )}

                <button
                  onClick={() => {
                    if (!currentUser) {
                      if (confirm('You need to sign in to place bets. Create an account?')) {
                        window.location.href = '/login';
                      }
                      return;
                    }
                    handlePlaceBet();
                  }}
                  disabled={currentUser && (!betAmount || submitting)}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-colors ${
                    !currentUser
                      ? 'bg-brand-red text-white hover:bg-brand-darkred cursor-pointer'
                      : 'bg-brand-red text-white hover:bg-brand-darkred disabled:bg-gray-300 disabled:cursor-not-allowed'
                  }`}
                >
                  {!currentUser 
                    ? 'Sign In to Place Bet' 
                    : (submitting ? 'Placing Bet...' : 'Place Bet')
                  }
                </button>
              </>
            )}
          </div>

          <div className="bg-white rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-gray-900">Liquidity Pool</h3>
            <p className="text-sm text-gray-700">YES: {round2(market.liquidityPool?.yes || 0)}</p>
            <p className="text-sm text-gray-700">NO: {round2(market.liquidityPool?.no || 0)}</p>
          </div>
        </div>

        {/* Live Trade Feed - 1 column */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg p-6 sticky top-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <span className="text-2xl">📊</span>
              Live Feed
            </h2>
            
            {trades.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-8">No trades yet</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {trades.map((trade) => {
                  const probChange = trade.oldProbability 
                    ? ((trade.newProbability - trade.oldProbability) * 100).toFixed(1)
                    : '0.0';
                  const isPositive = parseFloat(probChange) > 0;
                  
                  return (
                    <div key={trade.id} className="border-l-4 border-gray-200 pl-3 py-2 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between mb-1">
                        <span className="font-semibold text-sm text-gray-900">{trade.netid}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          trade.side === 'YES' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {trade.side}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 font-medium mb-1">
                        {trade.amount} rep
                      </p>
                      {trade.oldProbability && (
                        <p className="text-xs text-gray-600">
                          {Math.round(trade.oldProbability * 100)}% → {Math.round(trade.newProbability * 100)}%
                          <span className={`ml-1 font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                            ({isPositive ? '+' : ''}{probChange}%)
                          </span>
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {trade.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}