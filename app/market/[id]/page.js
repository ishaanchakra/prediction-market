'use client';
import { useEffect, useState } from 'react';
import { doc, getDoc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useParams } from 'next/navigation';
import { calculateBet } from '@/utils/amm';

export default function MarketPage() {
  const params = useParams();
  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [betAmount, setBetAmount] = useState('');
  const [selectedSide, setSelectedSide] = useState('YES');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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

  // Update preview when bet amount or side changes
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
      
      // Check user's rep balance
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
      
      // Create bet document
      await addDoc(collection(db, 'bets'), {
        userId: auth.currentUser.uid,
        marketId: params.id,
        side: selectedSide,
        amount: amount,
        shares: result.shares,
        probability: result.newProbability,
        timestamp: new Date()
      });
  
      // Update market liquidity
      await updateDoc(doc(db, 'markets', params.id), {
        liquidityPool: result.newPool,
        probability: result.newProbability
      });
  
      // Deduct rep from user
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        weeklyRep: userData.weeklyRep - amount
      });
  
      // Refresh market data
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

  return (
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

      <div className="bg-white border rounded-lg p-6 mb-6">
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
      </div>

      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Liquidity Pool</h3>
        <p className="text-sm text-gray-600">YES: {market.liquidityPool?.yes || 0}</p>
        <p className="text-sm text-gray-600">NO: {market.liquidityPool?.no || 0}</p>
      </div>
    </div>
  );
}