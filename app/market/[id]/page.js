'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { calculateBet } from '@/utils/amm';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function MarketPage() {
  const params = useParams();
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [betAmount, setBetAmount] = useState('');
  const [selectedSide, setSelectedSide] = useState('YES');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [betHistory, setBetHistory] = useState([]);

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
    if (market && betAmount && parseFloat(betAmount) > 0) {
      try {
        const result = calculateBet(market.liquidityPool, parseFloat(betAmount), selectedSide);
        setPreview(result);
      } catch (error) {
        setPreview(null);
      }
    } else {
      setPreview(null);
    }
  }, [betAmount, selectedSide, market]);

  async function handlePlaceBet() {
    if (!auth.currentUser) {
      alert('Please log in to place bets');
      return;
    }

    if (!betAmount || parseFloat(betAmount) <= 0) {
      alert('Please enter a valid bet amount');
      return;
    }

    setSubmitting(true);
    try {
      const amount = parseFloat(betAmount);
      
      const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
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
        userId: auth.currentUser.uid,
        marketId: params.id,
        side: selectedSide,
        amount: amount,
        shares: result.shares,
        probability: result.newProbability,
        timestamp: new Date()
      });

      await updateDoc(doc(db, 'markets', params.id), {
        liquidityPool: result.newPool,
        probability: result.newProbability
      });

      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
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

  if (loading) return <div className="p-8">Loading...</div>;
  if (!market) return <div className="p-8">Market not found</div>;

  const isResolved = market.resolution !== null;

  return (
    <div className="min-h-screen bg-cream py-8">
      <div className="max-w-4xl mx-auto px-6">
        {/* Market Title */}
        <div className="mb-8">
          <Link href="/" className="text-carnelian font-semibold hover:underline mb-4 inline-block">
            ← Back to markets
          </Link>
          <h1 className="text-5xl font-black text-gray-900 leading-tight">
            {market.question}
          </h1>
        </div>

        {/* Current Probability - Big Display */}
        <div className="bg-gradient-to-br from-carnelian to-carnelian-dark rounded-3xl p-8 mb-6 shadow-xl">
          <div className="text-center">
            <p className="text-white text-lg font-bold mb-2 opacity-90 uppercase tracking-wide">
              Yes Chance
            </p>
            <p className="text-8xl font-black text-white">
              {typeof market.probability === 'number'
                ? `${Math.round(market.probability * 100)}%`
                : '—'}
            </p>
          </div>
        </div>

        {/* Chart */}
        {betHistory.length > 1 && (
          <div className="bg-white rounded-3xl border-2 border-gray-100 p-8 mb-6 shadow-lg">
            <h2 className="text-2xl font-black mb-6 text-gray-900">Market Activity</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={betHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(timestamp) => {
                    const date = new Date(timestamp);
                    return `${date.getMonth()+1}/${date.getDate()}`;
                  }}
                  tick={{ fontSize: 13, fontWeight: 600, fill: '#666' }}
                />
                <YAxis 
                  domain={['dataMin - 0.1', 'dataMax + 0.1']}
                  tickFormatter={(value) => `${Math.round(value * 100)}%`}
                  tick={{ fontSize: 13, fontWeight: 600, fill: '#666' }}
                />
                <Tooltip 
                  formatter={(value) => [`${Math.round(value * 100)}%`, 'Probability']}
                  labelFormatter={(timestamp) => new Date(timestamp).toLocaleString()}
                  contentStyle={{ 
                    backgroundColor: '#fff', 
                    border: '2px solid #B31B1B',
                    borderRadius: '12px',
                    fontWeight: 600
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="probability" 
                  stroke="#B31B1B" 
                  strokeWidth={4}
                  dot={{ fill: '#B31B1B', r: 5, strokeWidth: 2, stroke: '#fff' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Betting Interface */}
        <div className="bg-white rounded-3xl border-2 border-gray-100 p-8 mb-6 shadow-lg">
          {isResolved ? (
            <div className="text-center py-12">
              <div className="text-7xl mb-6">
                {market.resolution === 'YES' ? '🎉' : '😔'}
              </div>
              <h2 className="text-4xl font-black mb-3 text-gray-900">
                Resolved: {market.resolution}
              </h2>
              <p className="text-xl text-gray-600 font-semibold">
                This market is closed for trading
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-3xl font-black mb-6 text-gray-900">Place Your Bet</h2>
              
              {/* YES/NO Buttons */}
<div className="grid grid-cols-2 gap-4 mb-6">
  <button
    onClick={() => setSelectedSide('YES')}
    className={`py-6 px-8 rounded-2xl font-black text-2xl transition-all ${
      selectedSide === 'YES'
        ? 'bg-green-600 text-white shadow-xl scale-105'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`}
  >
    YES
  </button>
  <button
    onClick={() => setSelectedSide('NO')}
    className={`py-6 px-8 rounded-2xl font-black text-2xl transition-all ${
      selectedSide === 'NO'
        ? 'bg-red-600 text-white shadow-xl scale-105'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`}
  >
    NO
  </button>
</div>

              {/* Amount Input */}
              <div className="mb-6">
                <label className="block text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">
                  Bet Amount (rep)
                </label>
                <input
                  type="number"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="w-full px-6 py-4 border-2 border-gray-200 rounded-2xl text-2xl font-bold focus:ring-4 focus:ring-carnelian/20 focus:border-carnelian transition-all"
                  min="1"
                />
              </div>

              {/* Preview */}
              {preview && (
                <div className="bg-cream border-2 border-carnelian/20 rounded-2xl p-6 mb-6">
                  <p className="text-sm font-bold text-gray-600 mb-3 uppercase tracking-wide">Preview</p>
                  <p className="text-2xl font-black text-carnelian mb-1">
                    {preview.shares.toFixed(2)} shares
                  </p>
                  <p className="text-gray-600 font-semibold">
                    New probability: {Math.round(preview.newProbability * 100)}%
                  </p>
                </div>
              )}

              {/* Submit Button */}
              <button
                onClick={handlePlaceBet}
                disabled={!betAmount || submitting || !auth.currentUser}
                className="w-full bg-gradient-to-r from-carnelian to-carnelian-dark text-white py-5 px-8 rounded-2xl text-xl font-black hover:shadow-2xl disabled:bg-gray-300 disabled:cursor-not-allowed transition-all transform hover:scale-105 disabled:transform-none"
              >
                {submitting ? 'Placing Bet...' : `Bet ${selectedSide}`}
              </button>

              {!auth.currentUser && (
                <p className="text-center text-carnelian font-bold mt-4">
                  Please log in to place bets
                </p>
              )}
            </>
          )}
        </div>

        {/* Liquidity Pool */}
        <div className="bg-white rounded-2xl border-2 border-gray-100 p-6 shadow-md">
          <h3 className="font-black text-gray-900 mb-3 text-lg">Liquidity Pool</h3>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="bg-cream rounded-xl p-4">
              <p className="text-xs font-bold text-gray-500 uppercase mb-1">YES</p>
              <p className="text-2xl font-black text-carnelian">
                {market.liquidityPool?.yes?.toFixed(0) || 0}
              </p>
            </div>
            <div className="bg-cream rounded-xl p-4">
              <p className="text-xs font-bold text-gray-500 uppercase mb-1">NO</p>
              <p className="text-2xl font-black text-gray-700">
                {market.liquidityPool?.no?.toFixed(0) || 0}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}