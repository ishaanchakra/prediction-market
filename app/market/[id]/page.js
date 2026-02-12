'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
  deleteDoc
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { calculateBet, calculateSell } from '@/utils/lmsr';
import { MARKET_STATUS, getMarketStatus, isTradeableMarket } from '@/utils/marketStatus';
import InfoTooltip from '@/app/components/InfoTooltip';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  CartesianGrid,
  XAxis,
  YAxis
} from 'recharts';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

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
  const [currentUser, setCurrentUser] = useState(null);
  const [userPosition, setUserPosition] = useState({ yesShares: 0, noShares: 0, yesInvested: 0, noInvested: 0 });
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellSide, setSellSide] = useState('YES');
  const [sellAmount, setSellAmount] = useState('');
  const [sellPreview, setSellPreview] = useState(null);
  const [selling, setSelling] = useState(false);
  const [exitValues, setExitValues] = useState({ yesExit: 0, noExit: 0 });
  const [recentTrades, setRecentTrades] = useState([]);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const marketStatus = getMarketStatus(market);
  const canTrade = currentUser && isTradeableMarket(market);
  const isLocked = marketStatus === MARKET_STATUS.LOCKED;
  const isResolved = marketStatus === MARKET_STATUS.RESOLVED;
  const isCancelled = marketStatus === MARKET_STATUS.CANCELLED;

  const isAdminUser = useMemo(() => {
    return !!(currentUser?.email && ADMIN_EMAILS.includes(currentUser.email));
  }, [currentUser]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => setCurrentUser(user));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchMarket() {
      try {
        const docRef = doc(db, 'markets', params.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setMarket({ id: docSnap.id, ...docSnap.data() });
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

        snapshot.docs.forEach((snapshotDoc) => {
          const bet = snapshotDoc.data();
          if (bet.side === 'YES') {
            yesShares += bet.shares || 0;
            if (bet.amount > 0) yesInvested += bet.amount;
          } else {
            noShares += bet.shares || 0;
            if (bet.amount > 0) noInvested += bet.amount;
          }
        });

        setUserPosition({ yesShares, noShares, yesInvested, noInvested });
      } catch (error) {
        console.error('Error fetching user position:', error);
      }
    }

    fetchUserPosition();
  }, [currentUser, params.id, market?.probability]);

  useEffect(() => {
    if (!market?.outstandingShares) return;

    try {
      const yesExit = userPosition.yesShares > 0
        ? calculateSell(market.outstandingShares, userPosition.yesShares, 'YES', market.b).payout
        : 0;
      const noExit = userPosition.noShares > 0
        ? calculateSell(market.outstandingShares, userPosition.noShares, 'NO', market.b).payout
        : 0;
      setExitValues({ yesExit, noExit });
    } catch (error) {
      console.error('Error calculating exit values:', error);
      setExitValues({ yesExit: 0, noExit: 0 });
    }
  }, [market, userPosition]);

  useEffect(() => {
    async function fetchBetHistory() {
      if (!params.id || !market) return;

      try {
        const betsQuery = query(
          collection(db, 'bets'),
          where('marketId', '==', params.id),
          orderBy('timestamp', 'asc')
        );
        const snapshot = await getDocs(betsQuery);
        const trades = snapshot.docs.map((snapshotDoc) => snapshotDoc.data());

        const seededProbability =
          typeof market.initialProbability === 'number'
            ? market.initialProbability
            : typeof trades[0]?.probability === 'number'
              ? trades[0].probability
              : typeof market.probability === 'number'
                ? market.probability
                : 0.5;

        const rawHistory = [
          {
            timestamp: market?.createdAt?.toDate?.() || new Date(),
            probability: seededProbability
          },
          ...trades.map((bet) => ({
            timestamp: bet.timestamp?.toDate?.() || new Date(),
            probability: bet.probability
          }))
        ];

        const chartData = rawHistory.map((point) => ({
          timestamp: point.timestamp.getTime(),
          probability: point.probability
        }));

        if (typeof market?.probability === 'number') {
          chartData.push({ timestamp: Date.now(), probability: market.probability });
        }

        if (chartData.length < 2) {
          chartData.push({
            timestamp: Date.now(),
            probability: typeof market?.probability === 'number' ? market.probability : seededProbability
          });
        }

        setBetHistory(chartData);
      } catch (error) {
        console.error('Error fetching bet history:', error);
      }
    }

    fetchBetHistory();
  }, [params.id, market]);

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

            return { id: betDoc.id, ...bet, userName };
          })
        );

        setRecentTrades(trades);
      } catch (error) {
        console.error('Error fetching recent trades:', error);
      }
    }

    fetchRecentTrades();
  }, [params.id, market?.probability]);

  useEffect(() => {
    async function fetchComments() {
      if (!params.id) return;
      setCommentsLoading(true);
      try {
        const commentsQuery = query(
          collection(db, 'comments'),
          where('marketId', '==', params.id),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(commentsQuery);
        setComments(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
      } catch (error) {
        console.error('Error loading comments:', error);
      } finally {
        setCommentsLoading(false);
      }
    }

    fetchComments();
  }, [params.id]);

  useEffect(() => {
    if (market && betAmount && parseFloat(betAmount) > 0 && currentUser) {
      try {
        const result = calculateBet(market.outstandingShares, parseFloat(betAmount), selectedSide, market.b);
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
        const result = calculateSell(market.outstandingShares, parseFloat(sellAmount), sellSide, market.b);
        setSellPreview(result);
      } catch (error) {
        setSellPreview(null);
      }
    } else {
      setSellPreview(null);
    }
  }, [sellAmount, sellSide, market]);

  async function reloadMarket() {
    const updated = await getDoc(doc(db, 'markets', params.id));
    if (updated.exists()) {
      setMarket({ id: updated.id, ...updated.data() });
    }
  }

  async function handlePlaceBet() {
    if (!currentUser) {
      if (confirm('You need to sign in to place bets. Go to login page?')) {
        window.location.href = '/login';
      }
      return;
    }

    if (!isTradeableMarket(market)) {
      alert('Trading is currently locked for this market.');
      return;
    }

    if (!betAmount || parseFloat(betAmount) <= 0) {
      alert('Please enter a valid amount');
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
        alert(`Insufficient balance. You have $${userData.weeklyRep.toFixed(2)} available.`);
        return;
      }

      const result = calculateBet(market.outstandingShares, amount, selectedSide, market.b);

      await addDoc(collection(db, 'bets'), {
        userId: currentUser.uid,
        marketId: params.id,
        side: selectedSide,
        amount,
        shares: result.shares,
        probability: result.newProbability,
        timestamp: new Date(),
        type: 'BUY'
      });

      await updateDoc(doc(db, 'markets', params.id), {
        outstandingShares: result.newPool,
        probability: result.newProbability
      });

      await updateDoc(doc(db, 'users', currentUser.uid), {
        weeklyRep: round2(userData.weeklyRep - amount)
      });

      await reloadMarket();
      setBetAmount('');
      setPreview(null);
    } catch (error) {
      console.error('Error placing bet:', error);
      alert('Error placing bet. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSell() {
    if (!currentUser || !isTradeableMarket(market)) {
      alert('Selling is unavailable while this market is locked or closed.');
      return;
    }

    const sharesToSell = parseFloat(sellAmount);
    const availableShares = sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares;

    if (!sellAmount || sharesToSell <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (sharesToSell > availableShares) {
      alert(`Insufficient shares. You have ${availableShares.toFixed(2)} ${sellSide} shares.`);
      return;
    }

    setSelling(true);
    try {
      const result = calculateSell(market.outstandingShares, sharesToSell, sellSide, market.b);

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
        outstandingShares: result.newPool,
        probability: result.newProbability
      });

      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      const userData = userDoc.data();
      await updateDoc(doc(db, 'users', currentUser.uid), {
        weeklyRep: round2(userData.weeklyRep + result.payout)
      });

      await reloadMarket();
      setSellAmount('');
      setSellPreview(null);
      setShowSellModal(false);
    } catch (error) {
      console.error('Error selling shares:', error);
      alert('Error selling shares. Please try again.');
    } finally {
      setSelling(false);
    }
  }

  async function handlePostComment() {
    if (!currentUser) return;
    if (!newComment.trim()) return;

    setPostingComment(true);
    try {
      await addDoc(collection(db, 'comments'), {
        marketId: params.id,
        userId: currentUser.uid,
        userName: currentUser.email?.split('@')[0] || 'user',
        text: newComment.trim(),
        createdAt: new Date()
      });
      setNewComment('');

      const commentsQuery = query(
        collection(db, 'comments'),
        where('marketId', '==', params.id),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(commentsQuery);
      setComments(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    } catch (error) {
      console.error('Error posting comment:', error);
      alert('Unable to post comment right now.');
    } finally {
      setPostingComment(false);
    }
  }

  async function handleSaveComment(commentId) {
    if (!editingText.trim()) return;
    try {
      await updateDoc(doc(db, 'comments', commentId), {
        text: editingText.trim(),
        updatedAt: new Date()
      });
      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId ? { ...comment, text: editingText.trim(), updatedAt: new Date() } : comment
        )
      );
      setEditingCommentId(null);
      setEditingText('');
    } catch (error) {
      console.error('Error updating comment:', error);
      alert('Unable to update comment.');
    }
  }

  async function handleDeleteComment(comment) {
    const isOwner = currentUser?.uid === comment.userId;
    if (!isOwner && !isAdminUser) {
      alert('Only the owner or an admin can delete this comment.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'comments', comment.id));
      setComments((prev) => prev.filter((item) => item.id !== comment.id));
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert('Unable to delete comment.');
    }
  }

  if (loading) return <div className="p-8">Loading...</div>;
  if (!market) return <div className="p-8">Market not found</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <Link href="/" className="text-indigo-600 hover:underline mb-4 inline-block">
        ← Back to markets
      </Link>

      <h1 className="text-3xl font-bold mb-2 text-gray-900">{market.question}</h1>

      <div className="mb-6 inline-flex items-center gap-3">
        <div className="bg-indigo-100 rounded-lg px-6 py-3">
          <span className="text-4xl font-bold text-indigo-600">
            {typeof market.probability === 'number' ? `${Math.round(market.probability * 100)}%` : 'N/A'}
          </span>
          <span className="text-sm text-indigo-800 ml-2">chance</span>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold ${
            isLocked
              ? 'bg-yellow-100 text-yellow-800'
              : isResolved
                ? 'bg-green-100 text-green-800'
                : isCancelled
                  ? 'bg-gray-200 text-gray-700'
                  : 'bg-blue-100 text-blue-800'
          }`}
        >
          {marketStatus}
        </span>
      </div>

      {isLocked && (
        <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
          Trading is locked by admin. You can view history and comments, but cannot buy or sell until it is unlocked.
        </div>
      )}
      {isCancelled && (
        <div className="mb-6 rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
          This market was cancelled. Refunds were issued based on each user&apos;s net invested amount.
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {betHistory.length > 1 && (
            <div className="bg-white border rounded-xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 text-gray-900">Market Chart</h2>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={betHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.3} vertical={false} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(timestamp) => {
                      const date = new Date(timestamp);
                      const hours = date.getHours();
                      const ampm = hours >= 12 ? 'PM' : 'AM';
                      const displayHours = hours % 12 || 12;
                      const start = betHistory.length > 0 ? new Date(betHistory[0].timestamp) : date;
                      const spansDays = date.toDateString() !== start.toDateString();
                      return spansDays ? `${date.getMonth() + 1}/${date.getDate()} ${displayHours}${ampm}` : `${displayHours} ${ampm}`;
                    }}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    stroke="#e5e7eb"
                  />
                  <YAxis
                    domain={[0, 1]}
                    ticks={[0, 0.25, 0.5, 0.75, 1]}
                    tickFormatter={(value) => `${Math.round(value * 100)}%`}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    stroke="#e5e7eb"
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const date = new Date(label);
                      return (
                        <div className="bg-gray-900 text-white rounded-lg p-3 shadow-xl border border-gray-700">
                          <p className="text-xs text-gray-300 mb-1">{date.toLocaleString()}</p>
                          <p className="text-lg font-bold">{Math.round(payload[0].value * 100)}%</p>
                        </div>
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="probability"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
            {currentUser && !isResolved && !isCancelled && (userPosition.yesShares > 0 || userPosition.noShares > 0) && (
              <div className="bg-blue-50 border-b-2 border-blue-200 p-5">
                <h3 className="text-sm font-semibold mb-3 text-blue-900 uppercase tracking-wide">Your Position</h3>
                <div className="space-y-3">
                  {userPosition.yesShares > 0 && (
                    <PositionCard
                      side="YES"
                      shares={userPosition.yesShares}
                      invested={userPosition.yesInvested}
                      exitValue={exitValues.yesExit}
                      onSell={() => {
                        setSellSide('YES');
                        setShowSellModal(true);
                        setSellAmount('');
                        setSellPreview(null);
                      }}
                      canSell={!!canTrade}
                    />
                  )}
                  {userPosition.noShares > 0 && (
                    <PositionCard
                      side="NO"
                      shares={userPosition.noShares}
                      invested={userPosition.noInvested}
                      exitValue={exitValues.noExit}
                      onSell={() => {
                        setSellSide('NO');
                        setShowSellModal(true);
                        setSellAmount('');
                        setSellPreview(null);
                      }}
                      canSell={!!canTrade}
                    />
                  )}
                </div>
              </div>
            )}

            <div className="p-5">
              {isResolved ? (
                <div className="text-center py-6">
                  <div className="text-4xl mb-3">{market.resolution === 'YES' ? 'YES' : 'NO'}</div>
                  <h2 className="text-xl font-bold mb-1 text-gray-900">Resolved: {market.resolution}</h2>
                  <p className="text-sm text-gray-600">Winning side pays out one point per share.</p>
                </div>
              ) : isCancelled ? (
                <div className="text-center py-6">
                  <h2 className="text-xl font-bold mb-1 text-gray-900">Market Cancelled</h2>
                  <p className="text-sm text-gray-600">This market no longer accepts trades.</p>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-semibold mb-3 text-gray-900 uppercase tracking-wide">Place Bet</h3>

                  {!currentUser && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                      <p className="text-xs text-yellow-800">
                        <Link href="/login" className="underline font-semibold">Sign in</Link> to trade.
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={() => setSelectedSide('YES')}
                      disabled={!canTrade}
                      className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-colors ${
                        selectedSide === 'YES' ? 'bg-green-500 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      } disabled:opacity-50`}
                    >
                      YES
                    </button>
                    <button
                      onClick={() => setSelectedSide('NO')}
                      disabled={!canTrade}
                      className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-colors ${
                        selectedSide === 'NO' ? 'bg-red-500 text-white shadow-md' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      } disabled:opacity-50`}
                    >
                      NO
                    </button>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Amount ($)</label>
                    <input
                      type="number"
                      value={betAmount}
                      onChange={(e) => setBetAmount(e.target.value)}
                      placeholder={currentUser ? 'Enter amount' : 'Sign in to trade'}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm text-gray-900"
                      min="1"
                      disabled={!canTrade}
                    />
                  </div>

                  {preview && currentUser && (
                    <div className="bg-indigo-50 rounded-lg p-3 mb-4 border border-indigo-200 text-xs text-indigo-900 space-y-1">
                      <p className="font-semibold text-sm">Trade preview</p>
                      <p>You risk: ${Number(betAmount || 0).toFixed(2)}</p>
                      <p className="flex items-center gap-1">
                        Estimated shares: {preview.shares.toFixed(2)}
                        <InfoTooltip
                          label="Shares help"
                          text="Shares are your position size. If your side wins, your shares become payout."
                        />
                      </p>
                      <p>You receive if correct: ~${preview.shares.toFixed(2)}</p>
                      <p>Net if wrong: -${Number(betAmount || 0).toFixed(2)}</p>
                      <p className="pt-1 border-t border-indigo-200">New probability: {Math.round(preview.newProbability * 100)}%</p>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-lg border p-3 mb-4 text-xs text-gray-700">
                    If resolved YES, each YES share pays out. If resolved NO, each NO share pays out.
                  </div>

                  <button
                    onClick={handlePlaceBet}
                    disabled={!currentUser || !betAmount || submitting || !isTradeableMarket(market)}
                    className="w-full py-3 px-4 rounded-lg font-bold text-sm transition-colors bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Placing...' : isLocked ? 'Market Locked' : 'Place Bet'}
                  </button>
                </>
              )}
            </div>
          </div>

          {recentTrades.length > 0 && (
            <div className="bg-white border rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3 text-gray-900 uppercase tracking-wide flex items-center gap-2">
                Recent Activity
                <InfoTooltip
                  label="Shares help"
                  text="Shares are your position size. If your side wins, your shares become payout."
                />
              </h3>
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {recentTrades.map((trade, index) => {
                  const beforeProbability = recentTrades[index + 1]?.probability ?? market.initialProbability ?? market.probability ?? 0.5;
                  const afterProbability = trade.probability;
                  return (
                    <div key={trade.id} className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-bold ${
                              trade.type === 'SELL'
                                ? 'bg-orange-100 text-orange-700'
                                : trade.side === 'YES'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {trade.type === 'SELL' ? `SOLD ${trade.side}` : trade.side}
                          </span>
                          <span className="text-xs font-medium text-gray-900 truncate">{trade.userName}</span>
                        </div>
                        <p className="text-xs text-gray-600 mb-1">
                          {trade.type === 'SELL'
                            ? `${Math.abs(trade.shares).toFixed(1)} shares to $${Math.abs(trade.amount).toFixed(2)}`
                            : `$${trade.amount.toFixed(2)} to ${trade.shares.toFixed(1)} shares`}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-gray-500">{Math.round(beforeProbability * 100)}%</span>
                          <span className="text-gray-400">to</span>
                          <span className="font-semibold text-gray-900">{Math.round(afterProbability * 100)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-white border rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold mb-3 text-gray-900 uppercase tracking-wide">Comments</h3>
            {currentUser ? (
              <div className="mb-4 space-y-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Share your reasoning for YES or NO"
                  maxLength={400}
                  className="w-full rounded-lg border p-2 text-sm text-gray-900"
                  rows={3}
                />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">{newComment.length}/400</span>
                  <button
                    onClick={handlePostComment}
                    disabled={!newComment.trim() || postingComment}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
                  >
                    {postingComment ? 'Posting...' : 'Post Comment'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-600 mb-4">
                <Link href="/login" className="underline">Sign in</Link> to join the discussion.
              </p>
            )}

            {commentsLoading ? (
              <p className="text-sm text-gray-500">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-gray-500">No comments yet.</p>
            ) : (
              <div className="space-y-3 max-h-[360px] overflow-y-auto">
                {comments.map((comment) => {
                  const isOwner = currentUser?.uid === comment.userId;
                  const canDelete = isOwner || isAdminUser;

                  return (
                    <div key={comment.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-900">{comment.userName}</p>
                        <p className="text-xs text-gray-500">{comment.createdAt?.toDate?.()?.toLocaleString?.() || 'now'}</p>
                      </div>

                      {editingCommentId === comment.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="w-full rounded border p-2 text-sm text-gray-900"
                            rows={2}
                            maxLength={400}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveComment(comment.id)}
                              className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setEditingCommentId(null);
                                setEditingText('');
                              }}
                              className="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">{comment.text}</p>
                      )}

                      {currentUser && editingCommentId !== comment.id && (isOwner || canDelete) && (
                        <div className="mt-2 flex gap-2 text-xs">
                          {isOwner && (
                            <button
                              onClick={() => {
                                setEditingCommentId(comment.id);
                                setEditingText(comment.text);
                              }}
                              className="text-indigo-600 hover:underline"
                            >
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteComment(comment)}
                              className="text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {showSellModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">Sell {sellSide} Shares</h2>

            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Available:</span>
                <span className="font-semibold">{(sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares).toFixed(2)} shares</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Exit all now:</span>
                <span className="font-bold text-green-600">${(sellSide === 'YES' ? exitValues.yesExit : exitValues.noExit).toFixed(2)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Shares to Sell</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  min="0.01"
                  step="0.01"
                  max={sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares}
                  disabled={!isTradeableMarket(market)}
                />
                <button
                  onClick={() => setSellAmount((sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares).toString())}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-colors text-sm"
                  disabled={!isTradeableMarket(market)}
                >
                  Max
                </button>
              </div>
            </div>

            {sellPreview && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-600 mb-2">You will receive now:</p>
                <p className="font-bold text-2xl text-green-600">${sellPreview.payout.toFixed(2)}</p>
                <p className="text-xs text-gray-500 mt-2">New market probability: {Math.round(sellPreview.newProbability * 100)}%</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSell}
                disabled={!sellAmount || selling || parseFloat(sellAmount) <= 0 || !isTradeableMarket(market)}
                className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {selling ? 'Selling...' : isLocked ? 'Market Locked' : 'Confirm'}
              </button>

              <button
                onClick={() => {
                  setShowSellModal(false);
                  setSellAmount('');
                  setSellPreview(null);
                }}
                disabled={selling}
                className="flex-1 bg-gray-200 text-gray-700 py-3 px-6 rounded-lg font-semibold hover:bg-gray-300"
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

function PositionCard({ side, shares, invested, exitValue, onSell, canSell }) {
  const pnl = exitValue - invested;
  const isProfit = pnl >= 0;

  return (
    <div className="bg-white rounded-lg p-3 border border-blue-200">
      <div className="flex items-center justify-between mb-2">
        <span className={`font-bold text-sm ${side === 'YES' ? 'text-green-600' : 'text-red-600'}`}>{side}</span>
        <span className="text-lg font-bold text-gray-900">{shares.toFixed(1)} shares</span>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between text-gray-600">
          <span>You risked:</span>
          <span className="font-semibold">${invested.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Sell now for:</span>
          <span className="font-bold text-green-600">${exitValue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Current P/L:</span>
          <span className={`font-semibold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
            {isProfit ? '+$' : '-$'}
            {Math.abs(pnl).toFixed(2)}
          </span>
        </div>
      </div>
      <button
        onClick={onSell}
        disabled={!canSell}
        className="w-full mt-2 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:bg-gray-300"
      >
        Sell {side}
      </button>
    </div>
  );
}
