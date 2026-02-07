'use client';
import { useEffect, useState } from 'react';
<<<<<<< HEAD
import { doc, getDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';import { db, auth } from '@/lib/firebase';
=======
import { doc, getDoc, updateDoc, addDoc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7
import { useParams } from 'next/navigation';
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
<<<<<<< HEAD
  const [betHistory, setBetHistory] = useState([]); // ADD THIS LINE
=======
  const [betHistory, setBetHistory] = useState([]);
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7

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
        
        // Add initial 50% probability at market creation
        const history = [{
          timestamp: market?.createdAt?.toDate?.() || new Date(),
          probability: 0.5
        }];
        
        // Add each bet's probability
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
  const isResolved = market.resolution !== null; //checks if market is resolved

  const isResolved = market.resolution !== null;

  return (
<<<<<<< HEAD
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">{market.question}</h1>
      
      <div className="bg-indigo-50 rounded-lg p-6 mb-8">
        <p className="text-5xl font-bold text-indigo-600 text-center">
          {typeof market.probability === 'number'
            ? `${Math.round(market.probability * 100)}%`
            : 'N/A'}
        </p>
        <p className="text-center text-gray-600 mt-2">Current Probability</p>
      </div>

      {/* ADD THIS CHART SECTION */}
{betHistory.length > 1 && (
  <div className="bg-white border rounded-lg p-6 mb-6">
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
          domain={[0, 1]}
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
          stroke="#4f46e5" 
          strokeWidth={2}
          dot={{ fill: '#4f46e5', r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  </div>
)}

      <div className="bg-white border rounded-lg p-6 mb-6">
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
      
      <div className="flex gap-4 mb-4">
        <button
          onClick={() => setSelectedSide('YES')}
          className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${
            selectedSide === 'YES'
              ? 'bg-green-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          YES
        </button>
        <button
          onClick={() => setSelectedSide('NO')}
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Bet Amount (rep)
        </label>
        <input
          type="number"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value)}
          placeholder="Enter amount"
          className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          min="1"
        />
      </div>

      {preview && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <p className="text-sm text-gray-600 mb-2">Preview:</p>
          <p className="font-semibold">You'll receive: {preview.shares.toFixed(2)} shares</p>
          <p className="text-sm text-gray-600">New probability: {Math.round(preview.newProbability * 100)}%</p>
        </div>
      )}

      <button
        onClick={handlePlaceBet}
        disabled={!betAmount || submitting || !auth.currentUser}
        className="w-full bg-indigo-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Placing Bet...' : 'Place Bet'}
      </button>

      {!auth.currentUser && (
        <p className="text-sm text-red-600 mt-2 text-center">
          Please log in to place bets
        </p>
      )}
    </>
  )}
</div>
=======
    <div className="min-h-screen bg-eggshell p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-carnelian">{market.question}</h1>
        
        <div className="bg-carnelian rounded-lg p-6 mb-8 shadow-lg">
          <p className="text-5xl font-bold text-cream text-center">
            {typeof market.probability === 'number'
              ? `${Math.round(market.probability * 100)}%`
              : 'N/A'}
          </p>
          <p className="text-center text-cream mt-2 opacity-90">Current Probability</p>
        </div>

        {betHistory.length > 1 && (
          <div className="bg-cream border-2 border-carnelian rounded-lg p-6 mb-6 shadow-md">
            <h2 className="text-lg font-semibold mb-4 text-carnelian">Probability History</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={betHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(timestamp) => {
                    const date = new Date(timestamp);
                    return `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
                  }}
                  tick={{ fontSize: 12, fill: '#666' }}
                />
                <YAxis 
                  domain={['dataMin - 0.1', 'dataMax + 0.1']}
                  tickFormatter={(value) => `${Math.round(value * 100)}%`}
                  tick={{ fontSize: 12, fill: '#666' }}
                />
                <Tooltip 
                  formatter={(value) => `${Math.round(value * 100)}%`}
                  labelFormatter={(timestamp) => {
                    const date = new Date(timestamp);
                    return date.toLocaleString();
                  }}
                  contentStyle={{ backgroundColor: '#F7F4EF', border: '2px solid #B31B1B' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="probability" 
                  stroke="#B31B1B" 
                  strokeWidth={3}
                  dot={{ fill: '#B31B1B', r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="bg-cream border-2 border-carnelian rounded-lg p-6 mb-6 shadow-md">
          {isResolved ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">
                {market.resolution === 'YES' ? '✅' : '❌'}
              </div>
              <h2 className="text-2xl font-bold mb-2 text-carnelian">
                Market Resolved: {market.resolution}
              </h2>
              <p className="text-gray-600">
                This market is closed for betting.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-4 text-carnelian">Place a Bet</h2>
              
              <div className="flex gap-4 mb-4">
                <button
                  onClick={() => setSelectedSide('YES')}
                  className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${
                    selectedSide === 'YES'
                      ? 'bg-carnelian text-cream shadow-lg'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  YES
                </button>
                <button
                  onClick={() => setSelectedSide('NO')}
                  className={`flex-1 py-3 px-6 rounded-lg font-semibold transition-colors ${
                    selectedSide === 'NO'
                      ? 'bg-carnelian text-cream shadow-lg'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  NO
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bet Amount (rep)
                </label>
                <input
                  type="number"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-carnelian focus:border-carnelian"
                  min="1"
                />
              </div>
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7

              {preview && (
                <div className="bg-eggshell border border-carnelian rounded-lg p-4 mb-4">
                  <p className="text-sm text-gray-600 mb-2">Preview:</p>
                  <p className="font-semibold text-carnelian">You'll receive: {preview.shares.toFixed(2)} shares</p>
                  <p className="text-sm text-gray-600">New probability: {Math.round(preview.newProbability * 100)}%</p>
                </div>
              )}

              <button
                onClick={handlePlaceBet}
                disabled={!betAmount || submitting || !auth.currentUser}
                className="w-full bg-carnelian text-cream py-3 px-6 rounded-lg font-semibold hover:bg-carnelian-dark disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-md"
              >
                {submitting ? 'Placing Bet...' : 'Place Bet'}
              </button>

              {!auth.currentUser && (
                <p className="text-sm text-carnelian mt-2 text-center font-medium">
                  Please log in to place bets
                </p>
              )}
            </>
          )}
        </div>

        <div className="bg-cream border-2 border-carnelian rounded-lg p-4 shadow-md">
          <h3 className="font-semibold mb-2 text-carnelian">Liquidity Pool</h3>
          <p className="text-sm text-gray-600">YES: {market.liquidityPool?.yes?.toFixed(2) || 0}</p>
          <p className="text-sm text-gray-600">NO: {market.liquidityPool?.no?.toFixed(2) || 0}</p>
        </div>
      </div>
    </div>
  );
}