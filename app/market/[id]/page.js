'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { calculateBet, calculateSell } from '@/utils/amm';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Area, AreaChart, ReferenceLine } from 'recharts';

export default function MarketPage() {
  const params = useParams();
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [betAmount, setBetAmount] = useState('');
  const [selectedSide, setSelectedSide] = useState('YES');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [betHistory, setBetHistory] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  
  const [userPosition, setUserPosition] = useState({ 
    yesShares: 0, 
    noShares: 0,
    yesInvested: 0,
    noInvested: 0
  });
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellSide, setSellSide] = useState('YES');
  const [sellAmount, setSellAmount] = useState('');
  const [sellPreview, setSellPreview] = useState(null);
  const [selling, setSelling] = useState(false);
  const [exitValues, setExitValues] = useState({ yesExit: 0, noExit: 0 });
  const [recentTrades, setRecentTrades] = useState([]);

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

  useEffect(() => {
    async function fetchUserPosition() {
      if (!currentUser || !params.id) return;
      
      try {
        const betsQuery = query(
          collection(db, 'bets'),
          where('marketId', '==', params.id),
          where('userId', '==', currentUser.uid)
        );
        const snapshot = await getDocs(betsQuery);
        
        let yesShares = 0;
        let noShares = 0;
        let yesInvested = 0;
        let noInvested = 0;
        
        snapshot.docs.forEach(doc => {
          const bet = doc.data();
          if (bet.side === 'YES') {
            yesShares += bet.shares;
            yesInvested += bet.amount;
          } else {
            noShares += bet.shares;
            noInvested += bet.amount;
          }
        });
        
        setUserPosition({ yesShares, noShares, yesInvested, noInvested });
      } catch (error) {
        console.error('Error fetching user position:', error);
      }
    }
    
    fetchUserPosition();
  }, [currentUser, params.id, market]);

  useEffect(() => {
    if (!market || !market.liquidityPool) return;
    
    let yesExit = 0;
    let noExit = 0;
    
    try {
      if (userPosition.yesShares > 0) {
        const yesResult = calculateSell(market.liquidityPool, userPosition.yesShares, 'YES');
        yesExit = yesResult.payout;
      }
      
      if (userPosition.noShares > 0) {
        const noResult = calculateSell(market.liquidityPool, userPosition.noShares, 'NO');
        noExit = noResult.payout;
      }
      
      setExitValues({ yesExit, noExit });
    } catch (error) {
      console.error('Error calculating exit values:', error);
      setExitValues({ yesExit: 0, noExit: 0 });
    }
  }, [market, userPosition]);

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
        
        // Build raw history from trades
        const rawHistory = [{
          timestamp: market?.createdAt?.toDate?.() || new Date(),
          probability: market?.initialProbability || 0.5  // Use initial probability if available
        }];
        
        snapshot.docs.forEach(doc => {
          const bet = doc.data();
          rawHistory.push({
            timestamp: bet.timestamp?.toDate?.() || new Date(),
            probability: bet.probability
          });
        });
  
        // Normalize to hourly intervals for cleaner chart
        if (rawHistory.length > 0) {
          const startTime = rawHistory[0].timestamp.getTime();
          const endTime = new Date().getTime();
          const normalizedHistory = [];
          
          // Determine interval based on market age
          const ageInHours = (endTime - startTime) / (1000 * 60 * 60);
          let intervalMs;
          
          if (ageInHours < 6) {
            // Less than 6 hours: 15-minute intervals
            intervalMs = 15 * 60 * 1000;
          } else if (ageInHours < 24) {
            // Less than 24 hours: 30-minute intervals
            intervalMs = 30 * 60 * 1000;
          } else if (ageInHours < 72) {
            // Less than 3 days: 1-hour intervals
            intervalMs = 60 * 60 * 1000;
          } else {
            // More than 3 days: 3-hour intervals
            intervalMs = 3 * 60 * 60 * 1000;
          }
          
          // Create normalized time series
          let currentTime = startTime;
          let lastKnownProb = rawHistory[0].probability;
          let rawIndex = 0;
          
          while (currentTime <= endTime) {
            // Update lastKnownProb with all trades that happened before this time point
            while (rawIndex < rawHistory.length && rawHistory[rawIndex].timestamp.getTime() <= currentTime) {
              lastKnownProb = rawHistory[rawIndex].probability;
              rawIndex++;
            }
            
            normalizedHistory.push({
              timestamp: new Date(currentTime),
              probability: lastKnownProb
            });
            
            currentTime += intervalMs;
          }
          
          // IMPORTANT: Add current market probability as the final point to ensure sync
          if (market?.probability !== undefined) {
            // Replace the last point with current market state
            normalizedHistory[normalizedHistory.length - 1] = {
              timestamp: new Date(),
              probability: market.probability
            };
          }
          
          setBetHistory(normalizedHistory);
        } else {
          // No trades yet - show just current state
          setBetHistory([{
            timestamp: new Date(),
            probability: market?.probability || 0.5
          }]);
        }
      } catch (error) {
        console.error('Error fetching bet history:', error);
      }
    }
    
    if (market) {
      fetchBetHistory();
    }
  }, [market, params.id]);
  
  useEffect(() => {
    async function fetchRecentTrades() {
      if (!params.id) return;
      
      try {
        const q = query(
          collection(db, 'bets'),
          where('marketId', '==', params.id),
          orderBy('timestamp', 'desc'),
          limit(15)
        );
        const snapshot = await getDocs(q);
        
        const trades = await Promise.all(
          snapshot.docs.map(async (betDoc) => {
            const bet = betDoc.data();
            
            let userName = 'Anonymous';
            try {
              const userDoc = await getDoc(doc(db, 'users', bet.userId));
              if (userDoc.exists()) {
                userName = userDoc.data().email?.split('@')[0] || 'User';
              }
            } catch (error) {
              console.error('Error fetching user:', error);
            }
            
            return {
              id: betDoc.id,
              ...bet,
              userName
            };
          })
        );
        
        setRecentTrades(trades);
      } catch (error) {
        console.error('Error fetching recent trades:', error);
      }
    }
    
    fetchRecentTrades();
  }, [params.id, market]);

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

  useEffect(() => {
    if (market && sellAmount && parseFloat(sellAmount) > 0) {
      try {
        const result = calculateSell(market.liquidityPool, parseFloat(sellAmount), sellSide);
        setSellPreview(result);
      } catch (error) {
        setSellPreview(null);
      }
    } else {
      setSellPreview(null);
    }
  }, [sellAmount, sellSide, market]);

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
      const amount = parseFloat(betAmount);
      
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (!userDoc.exists()) {
        alert('User profile not found. Please log out and log back in.');
        return;
      }
      
      const userData = userDoc.data();
      if (userData.weeklyRep < amount) {
        alert(`Insufficient rep! You have ${userData.weeklyRep} rep available.`);
        setSubmitting(false);
        return;
      }

      const result = calculateBet(market.liquidityPool, amount, selectedSide);
      
      await addDoc(collection(db, 'bets'), {
        userId: currentUser.uid,
        marketId: params.id,
        side: selectedSide,
        amount: amount,
        shares: result.shares,
        probability: result.newProbability,
        timestamp: new Date(),
        type: 'BUY'
      });

      await updateDoc(doc(db, 'markets', params.id), {
        liquidityPool: result.newPool,
        probability: result.newProbability
      });

      await updateDoc(doc(db, 'users', currentUser.uid), {
        weeklyRep: userData.weeklyRep - amount
      });

      const docRef = doc(db, 'markets', params.id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setMarket({ id: docSnap.id, ...docSnap.data() });
      }

      setBetAmount('');
      setPreview(null);
      alert(`Bet placed! You have ${userData.weeklyRep - amount} rep remaining.`);
    } catch (error) {
      console.error('Error placing bet:', error);
      alert('Error placing bet. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSell() {
    if (!currentUser) return;
    
    const sharesToSell = parseFloat(sellAmount);
    const availableShares = sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares;
    
    if (!sellAmount || sharesToSell <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    
    if (sharesToSell > availableShares) {
      alert(`Insufficient shares! You have ${availableShares.toFixed(2)} ${sellSide} shares.`);
      return;
    }
    
    setSelling(true);
    try {
      const result = calculateSell(market.liquidityPool, sharesToSell, sellSide);
      
      await addDoc(collection(db, 'bets'), {
        userId: currentUser.uid,
        marketId: params.id,
        side: sellSide,
        amount: -result.payout,
        shares: -sharesToSell,
        probability: result.newProbability,
        timestamp: new Date(),
        type: 'SELL'
      });
      
      await updateDoc(doc(db, 'markets', params.id), {
        liquidityPool: result.newPool,
        probability: result.newProbability
      });
      
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      const userData = userDoc.data();
      await updateDoc(doc(db, 'users', currentUser.uid), {
        weeklyRep: userData.weeklyRep + result.payout
      });
      
      const docRef = doc(db, 'markets', params.id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setMarket({ id: docSnap.id, ...docSnap.data() });
      }
      
      setSellAmount('');
      setSellPreview(null);
      setShowSellModal(false);
      alert(`Sold ${sharesToSell.toFixed(2)} ${sellSide} shares for ${result.payout.toFixed(2)} rep!`);
    } catch (error) {
      console.error('Error selling shares:', error);
      alert('Error selling shares. Please try again.');
    } finally {
      setSelling(false);
    }
  }

  // Custom tooltip for liquidity pie chart
  const LiquidityTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border-2 border-gray-300 rounded-lg p-3 shadow-lg">
          <p className="font-semibold text-gray-900 mb-1">{payload[0].name} Pool</p>
          <p className="text-sm text-gray-600 mb-2">{payload[0].value.toFixed(2)} rep</p>
          <p className="text-xs text-gray-500 max-w-xs">
            The liquidity pool determines pricing. When you buy {payload[0].name}, you add rep to the opposite pool and receive shares proportional to this pool's size.
          </p>
        </div>
      );
    }
    return null;
  };

  // Custom tooltip for probability chart
  const ProbabilityTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const date = new Date(label);
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      
      return (
        <div className="bg-gray-900 text-white rounded-lg p-3 shadow-xl border border-gray-700">
          <p className="text-xs text-gray-300 mb-1">
            {date.toLocaleDateString()} {displayHours}:{minutes.toString().padStart(2, '0')} {ampm}
          </p>
          <p className="text-lg font-bold">
            {Math.round(payload[0].value * 100)}%
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) return <div className="p-8">Loading...</div>;
  if (!market) return <div className="p-8">Market not found</div>;

  const isResolved = market.resolution !== null;

  // Prepare pie chart data
  const pieData = [
    { name: 'YES', value: market.liquidityPool?.yes || 0, color: '#10b981' },
    { name: 'NO', value: market.liquidityPool?.no || 0, color: '#ef4444' }
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <Link href="/" className="text-indigo-600 hover:underline mb-4 inline-block">
        ← Back to markets
      </Link>
      
      <h1 className="text-3xl font-bold mb-2">{market.question}</h1>
      
      <div className="mb-6 inline-flex items-center gap-3">
        <div className="bg-indigo-100 rounded-lg px-6 py-3">
          <span className="text-4xl font-bold text-indigo-600">
            {typeof market.probability === 'number'
              ? `${Math.round(market.probability * 100)}%`
              : 'N/A'}
          </span>
          <span className="text-sm text-indigo-800 ml-2">chance</span>
        </div>
      </div>

      {/* Two column grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN - Charts */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Probability History Chart - Financial Style */}
          {betHistory.length > 1 && (
            <div className="bg-white border rounded-xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 text-gray-900">Probability History</h2>
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={betHistory}>
                  <defs>
                    <linearGradient id="colorProb" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid 
                    strokeDasharray="3 3" 
                    stroke="#e5e7eb" 
                    strokeOpacity={0.3}
                    vertical={false}
                  />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(timestamp) => {
                      const date = new Date(timestamp);
                      const hours = date.getHours();
                      const ampm = hours >= 12 ? 'PM' : 'AM';
                      const displayHours = hours % 12 || 12;
                      return `${displayHours} ${ampm}`;
                    }}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    stroke="#e5e7eb"
                    axisLine={{ stroke: '#e5e7eb' }}
                    tickLine={{ stroke: '#e5e7eb' }}
                  />
                  <YAxis 
                    domain={[0, 1]}
                    ticks={[0, 0.25, 0.5, 0.75, 1]}
                    tickFormatter={(value) => `${Math.round(value * 100)}%`}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    stroke="#e5e7eb"
                    axisLine={{ stroke: '#e5e7eb' }}
                    tickLine={{ stroke: '#e5e7eb' }}
                  />
                  <Tooltip content={<ProbabilityTooltip />} />
                  <ReferenceLine 
                    y={0.5} 
                    stroke="#9ca3af" 
                    strokeDasharray="3 3" 
                    strokeWidth={1}
                    strokeOpacity={0.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="probability"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="url(#colorProb)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Liquidity Pool Pie Chart */}
          <div className="bg-white border rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-semibold mb-4 text-gray-900">Liquidity Pool</h2>
              <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<LiquidityTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-6 mt-4">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-green-500"></div>
                <span className="text-sm text-gray-600">YES: {market.liquidityPool?.yes?.toFixed(1) || 0} rep</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full bg-red-500"></div>
                <span className="text-sm text-gray-600">NO: {market.liquidityPool?.no?.toFixed(1) || 0} rep</span>
              </div>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN - Trading & Activity */}
        <div className="space-y-6">

          {/* User Position + Trading Interface Combined */}
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            
            {/* User Position (if exists) */}
            {currentUser && !isResolved && (userPosition.yesShares > 0 || userPosition.noShares > 0) && (
              <div className="bg-blue-50 border-b-2 border-blue-200 p-5">
                <h3 className="text-sm font-semibold mb-3 text-blue-900 uppercase tracking-wide">Your Position</h3>
                <div className="space-y-3">
                  {userPosition.yesShares > 0 && (
                    <div className="bg-white rounded-lg p-3 border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-green-600 text-sm">YES</span>
                        <span className="text-lg font-bold text-gray-900">{userPosition.yesShares.toFixed(1)}</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between text-gray-600">
                          <span>Invested:</span>
                          <span className="font-semibold">{userPosition.yesInvested.toFixed(1)} rep</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Exit value:</span>
                          <span className="font-bold text-green-600">{exitValues.yesExit.toFixed(1)} rep</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">P/L:</span>
                          <span className={`font-semibold ${
                            exitValues.yesExit - userPosition.yesInvested >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {exitValues.yesExit - userPosition.yesInvested >= 0 ? '+' : ''}
                            {(exitValues.yesExit - userPosition.yesInvested).toFixed(1)}
                          </span>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setSellSide('YES');
                          setShowSellModal(true);
                          setSellAmount('');
                          setSellPreview(null);
                        }}
                        className="w-full mt-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                      >
                        Sell YES
                      </button>
                    </div>
                  )}
                  
                  {userPosition.noShares > 0 && (
                    <div className="bg-white rounded-lg p-3 border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-red-600 text-sm">NO</span>
                        <span className="text-lg font-bold text-gray-900">{userPosition.noShares.toFixed(1)}</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between text-gray-600">
                          <span>Invested:</span>
                          <span className="font-semibold">{userPosition.noInvested.toFixed(1)} rep</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Exit value:</span>
                          <span className="font-bold text-green-600">{exitValues.noExit.toFixed(1)} rep</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">P/L:</span>
                          <span className={`font-semibold ${
                            exitValues.noExit - userPosition.noInvested >= 0 ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {exitValues.noExit - userPosition.noInvested >= 0 ? '+' : ''}
                            {(exitValues.noExit - userPosition.noInvested).toFixed(1)}
                          </span>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setSellSide('NO');
                          setShowSellModal(true);
                          setSellAmount('');
                          setSellPreview(null);
                        }}
                        className="w-full mt-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors"
                      >
                        Sell NO
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Trading Interface */}
            <div className="p-5">
              {isResolved ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-3">
                    {market.resolution === 'YES' ? '✅' : '❌'}
                  </div>
                  <h2 className="text-xl font-bold mb-1">
                    Resolved: {market.resolution}
                  </h2>
                  <p className="text-sm text-gray-600">
                    Market closed
                  </p>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-semibold mb-3 text-gray-900 uppercase tracking-wide">Place Bet</h3>
                  
                  {!currentUser && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                      <p className="text-xs text-yellow-800">
                        🔒 <Link href="/login" className="underline font-semibold">Sign in</Link> to trade
                      </p>
                    </div>
                  )}
                  
                  <div className="flex gap-2 mb-4">
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
                      className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-colors ${
                        selectedSide === 'YES'
                          ? 'bg-green-500 text-white shadow-md'
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
                      className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-colors ${
                        selectedSide === 'NO'
                          ? 'bg-red-500 text-white shadow-md'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      NO
                    </button>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">
                      Amount (rep)
                    </label>
                    <input
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    placeholder={currentUser ? "Enter amount" : "Sign in to trade"}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm text-gray-900"
                    min="1"
                    disabled={!currentUser}
                  />
                  </div>

                  {preview && currentUser && (
                    <div className="bg-indigo-50 rounded-lg p-3 mb-4 border border-indigo-200">
                      <p className="text-xs text-indigo-800 mb-1">Preview:</p>
                      <p className="text-sm font-bold text-indigo-900">{preview.shares.toFixed(2)} shares</p>
                      <p className="text-xs text-indigo-700">New prob: {Math.round(preview.newProbability * 100)}%</p>
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
                    className={`w-full py-3 px-4 rounded-lg font-bold text-sm transition-colors ${
                      !currentUser
                        ? 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed'
                    }`}
                  >
                    {!currentUser 
                      ? 'Sign In to Trade' 
                      : (submitting ? 'Placing...' : 'Place Bet')
                    }
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Recent Activity Feed */}
{/* Recent Activity Feed */}
{recentTrades.length > 0 && (
  <div className="bg-white border rounded-xl p-5 shadow-sm">
    <h3 className="text-sm font-semibold mb-3 text-gray-900 uppercase tracking-wide">Recent Activity</h3>
    <div className="space-y-2 max-h-[500px] overflow-y-auto">
      {recentTrades.map((trade, index) => {
        // Get probability before this trade (from the trade that happened right before it)
        // Remember: trades are sorted newest first, so index+1 is the previous trade chronologically
        const beforeProbability = recentTrades[index + 1]?.probability || market?.createdAt?.probability || 0.5;
        const afterProbability = trade.probability;
        
        return (
          <div key={trade.id} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  trade.type === 'SELL' 
                    ? 'bg-orange-100 text-orange-700'
                    : trade.side === 'YES' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-red-100 text-red-700'
                }`}>
                  {trade.type === 'SELL' ? `SOLD ${trade.side}` : trade.side}
                </span>
                <span className="text-xs font-medium text-gray-900 truncate">{trade.userName}</span>
              </div>
              <p className="text-xs text-gray-600 mb-1">
                {trade.type === 'SELL' 
                  ? `${Math.abs(trade.shares).toFixed(1)} shares → ${Math.abs(trade.amount).toFixed(1)} rep`
                  : `${trade.amount.toFixed(1)} rep → ${trade.shares.toFixed(1)} shares`
                }
              </p>
              {/* Show probability change: before → after */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-gray-500">{Math.round(beforeProbability * 100)}%</span>
                <span className="text-gray-400">→</span>
                <span className="font-semibold text-gray-900">{Math.round(afterProbability * 100)}%</span>
                <span className={`font-semibold ml-1 ${
                  afterProbability > beforeProbability ? 'text-green-600' : 'text-red-600'
                }`}>
                  ({afterProbability > beforeProbability ? '+' : ''}
                  {((afterProbability - beforeProbability) * 100).toFixed(1)}%)
                </span>
              </div>
            </div>
            <div className="text-right ml-2">
              <p className="text-xs text-gray-400">
                {(() => {
                  const date = trade.timestamp?.toDate?.();
                  if (!date) return 'now';
                  const hours = date.getHours();
                  const minutes = date.getMinutes();
                  const ampm = hours >= 12 ? 'PM' : 'AM';
                  const displayHours = hours % 12 || 12;
                  return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
                })()}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}
        </div>
      </div>

      {/* Sell Modal */}
      {showSellModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            <h2 className="text-2xl font-bold mb-4">Sell {sellSide} Shares</h2>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Available:</span>
                <span className="font-semibold">{(sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares).toFixed(2)} shares</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Exit all now:</span>
                <span className="font-bold text-green-600">{(sellSide === 'YES' ? exitValues.yesExit : exitValues.noExit).toFixed(2)} rep</span>
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Shares to Sell
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min="0.01"
                  step="0.01"
                  max={sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares}
                />
                <button
                  onClick={() => setSellAmount((sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares).toString())}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors text-sm"
                >
                  Max
                </button>
              </div>
            </div>

            {sellPreview && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-600 mb-2">You will receive:</p>
                <p className="font-bold text-2xl text-green-600">
                  {sellPreview.payout.toFixed(2)} rep
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  New market probability: {Math.round(sellPreview.newProbability * 100)}%
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSell}
                disabled={!sellAmount || selling || parseFloat(sellAmount) <= 0}
                className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                {selling ? 'Selling...' : 'Confirm'}
              </button>
              
              <button
                onClick={() => {
                  setShowSellModal(false);
                  setSellAmount('');
                  setSellPreview(null);
                }}
                disabled={selling}
                className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}