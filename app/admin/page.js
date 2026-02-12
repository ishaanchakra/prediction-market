'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  writeBatch,
  addDoc,
  orderBy
} from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import { calculateRefundsByUser, round2 } from '@/utils/refunds';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

export default function AdminPage() {
  const [user, setUser] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [locking, setLocking] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newMarketQuestion, setNewMarketQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [initialProbability, setInitialProbability] = useState(50);
  const [bValue, setBValue] = useState(100);
  const [editingRequestId, setEditingRequestId] = useState(null);
  const [requestEdits, setRequestEdits] = useState({});
  const [processingRequestId, setProcessingRequestId] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      if (!ADMIN_EMAILS.includes(currentUser.email)) {
        alert('Access denied. Admin only.');
        router.push('/');
        return;
      }

      setUser(currentUser);
      await Promise.all([fetchUnresolvedMarkets(), fetchPendingRequests()]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  async function fetchUnresolvedMarkets() {
    try {
      const q = query(collection(db, 'markets'), where('resolution', '==', null));
      const snapshot = await getDocs(q);
      const marketData = snapshot.docs
        .map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data()
        }))
        .filter((market) => getMarketStatus(market) !== MARKET_STATUS.CANCELLED)
        .sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
          return bTime - aTime;
        });
      setMarkets(marketData);
    } catch (error) {
      console.error('Error fetching markets:', error);
    }
  }

  async function fetchPendingRequests() {
    try {
      const q = query(
        collection(db, 'marketRequests'),
        where('status', '==', 'PENDING'),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      setRequests(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    } catch (error) {
      console.error('Error fetching requests:', error);
    }
  }

  async function createMarket({ question, probabilityPercent, liquidityB }) {
    const probDecimal = probabilityPercent / 100;
    const b = liquidityB;
    const qYes = round2(b * Math.log(probDecimal / (1 - probDecimal)));

    await addDoc(collection(db, 'markets'), {
      question: question.trim(),
      probability: round2(probDecimal),
      initialProbability: round2(probDecimal),
      outstandingShares: {
        yes: qYes,
        no: 0
      },
      b,
      status: MARKET_STATUS.OPEN,
      resolution: null,
      createdAt: new Date()
    });
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
      await createMarket({ question: newMarketQuestion, probabilityPercent: initialProbability, liquidityB: bValue });

      alert('Market created successfully!');
      setNewMarketQuestion('');
      setInitialProbability(50);
      setBValue(100);
      setShowCreateForm(false);
      await fetchUnresolvedMarkets();
    } catch (error) {
      console.error('Error creating market:', error);
      alert('Error creating market. Check console.');
    } finally {
      setCreating(false);
    }
  }

  function startEditingRequest(request) {
    setEditingRequestId(request.id);
    setRequestEdits((prev) => ({
      ...prev,
      [request.id]: {
        question: request.question || '',
        initialProbability: request.initialProbability || 50,
        liquidityB: request.liquidityB || 100,
        resolutionRules: request.resolutionRules || '',
        resolutionDate: request.resolutionDate?.toDate?.()
          ? request.resolutionDate.toDate().toISOString().split('T')[0]
          : ''
      }
    }));
  }

  async function saveRequestEdits(requestId) {
    const edit = requestEdits[requestId];
    if (!edit) return;

    if (!edit.question.trim() || !edit.resolutionRules.trim() || !edit.resolutionDate) {
      alert('Please keep required request fields filled.');
      return;
    }

    if (edit.initialProbability < 1 || edit.initialProbability > 99) {
      alert('Initial probability must be between 1% and 99%.');
      return;
    }

    setProcessingRequestId(requestId);
    try {
      await updateDoc(doc(db, 'marketRequests', requestId), {
        question: edit.question.trim(),
        initialProbability: Number(edit.initialProbability),
        liquidityB: Number(edit.liquidityB),
        resolutionRules: edit.resolutionRules.trim(),
        resolutionDate: new Date(edit.resolutionDate),
        updatedAt: new Date()
      });

      setEditingRequestId(null);
      await fetchPendingRequests();
    } catch (error) {
      console.error('Error saving request edit:', error);
      alert('Could not save edits.');
    } finally {
      setProcessingRequestId(null);
    }
  }

  async function handleApproveRequest(request) {
    const edit = requestEdits[request.id] || {
      question: request.question,
      initialProbability: request.initialProbability,
      liquidityB: request.liquidityB,
      resolutionRules: request.resolutionRules,
      resolutionDate: request.resolutionDate?.toDate?.()
        ? request.resolutionDate.toDate().toISOString().split('T')[0]
        : ''
    };

    if (!edit.question?.trim() || !edit.resolutionRules?.trim() || !edit.resolutionDate) {
      alert('Request must include question, rules, and resolution date before approval.');
      return;
    }

    setProcessingRequestId(request.id);
    try {
      await createMarket({
        question: edit.question,
        probabilityPercent: Number(edit.initialProbability),
        liquidityB: Number(edit.liquidityB)
      });

      await updateDoc(doc(db, 'marketRequests', request.id), {
        question: edit.question.trim(),
        initialProbability: Number(edit.initialProbability),
        liquidityB: Number(edit.liquidityB),
        resolutionRules: edit.resolutionRules.trim(),
        resolutionDate: new Date(edit.resolutionDate),
        status: 'APPROVED',
        adminNotes: 'Approved and published.',
        reviewedBy: user.email,
        reviewedAt: new Date(),
        updatedAt: new Date()
      });

      setEditingRequestId(null);
      await Promise.all([fetchUnresolvedMarkets(), fetchPendingRequests()]);
    } catch (error) {
      console.error('Error approving request:', error);
      alert('Error approving request.');
    } finally {
      setProcessingRequestId(null);
    }
  }

  async function handleRejectRequest(requestId) {
    const reason = prompt('Reason for rejection (required):');
    if (!reason || !reason.trim()) {
      alert('A rejection reason is required.');
      return;
    }

    setProcessingRequestId(requestId);
    try {
      await updateDoc(doc(db, 'marketRequests', requestId), {
        status: 'REJECTED',
        adminNotes: reason.trim(),
        reviewedBy: user.email,
        reviewedAt: new Date(),
        updatedAt: new Date()
      });

      await fetchPendingRequests();
    } catch (error) {
      console.error('Error rejecting request:', error);
      alert('Error rejecting request.');
    } finally {
      setProcessingRequestId(null);
    }
  }

  async function handleToggleLock(market, nextStatus) {
    setLocking(market.id);
    try {
      const payload = { status: nextStatus };
      if (nextStatus === MARKET_STATUS.LOCKED) {
        payload.lockedAt = new Date();
      }
      if (nextStatus === MARKET_STATUS.OPEN) {
        payload.lockedAt = null;
      }
      await updateDoc(doc(db, 'markets', market.id), payload);
      await fetchUnresolvedMarkets();
    } catch (error) {
      console.error('Error locking market:', error);
      alert('Error updating lock state.');
    } finally {
      setLocking(null);
    }
  }

  async function handleResolve(marketId, resolution) {
    if (!confirm(`Are you sure you want to resolve this market as ${resolution}?`)) {
      return;
    }

    setResolving(marketId);
    try {
      const betsQuery = query(collection(db, 'bets'), where('marketId', '==', marketId));
      const betsSnapshot = await getDocs(betsQuery);

      const batch = writeBatch(db);
      const userAdjustments = {};

      betsSnapshot.docs.forEach((betDoc) => {
        const bet = betDoc.data();
        if (!userAdjustments[bet.userId]) {
          userAdjustments[bet.userId] = { payout: 0, lostInvestment: 0 };
        }

        if (bet.side === resolution) {
          userAdjustments[bet.userId].payout = round2(userAdjustments[bet.userId].payout + round2(bet.shares));
        } else if (bet.amount > 0) {
          userAdjustments[bet.userId].lostInvestment = round2(
            userAdjustments[bet.userId].lostInvestment + round2(bet.amount)
          );
        }
      });

      const marketDoc = await getDoc(doc(db, 'markets', marketId));
      const marketQuestion = marketDoc.data().question;

      for (const [userId, adj] of Object.entries(userAdjustments)) {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) continue;

        const userData = userSnap.data();
        const newWeeklyRep = round2(userData.weeklyRep + adj.payout);
        const newLifetimeRep = round2(userData.lifetimeRep + adj.payout - adj.lostInvestment);

        batch.update(userRef, {
          weeklyRep: newWeeklyRep,
          lifetimeRep: newLifetimeRep
        });

        if (adj.payout > 0) {
          batch.set(doc(collection(db, 'notifications')), {
            userId,
            type: 'payout',
            marketId,
            marketQuestion,
            amount: round2(adj.payout),
            resolution,
            read: false,
            createdAt: new Date()
          });
        }

        if (adj.lostInvestment > 0) {
          batch.set(doc(collection(db, 'notifications')), {
            userId,
            type: 'loss',
            marketId,
            marketQuestion,
            amount: round2(adj.lostInvestment),
            resolution,
            read: false,
            createdAt: new Date()
          });
        }
      }

      batch.update(doc(db, 'markets', marketId), {
        status: MARKET_STATUS.RESOLVED,
        resolution,
        resolvedAt: new Date()
      });

      await batch.commit();

      alert(`Market resolved as ${resolution}. Payouts distributed.`);
      await fetchUnresolvedMarkets();
    } catch (error) {
      console.error('Error resolving market:', error);
      alert('Error resolving market. Check console.');
    } finally {
      setResolving(null);
    }
  }

  async function handleCancelAndRefund(marketId) {
    const reason = prompt('Optional cancellation reason (leave blank to skip):') || '';
    if (!confirm('Cancel this market and issue full refunds of net invested amounts?')) {
      return;
    }

    setCancelling(marketId);
    try {
      const betsQuery = query(collection(db, 'bets'), where('marketId', '==', marketId));
      const betsSnapshot = await getDocs(betsQuery);
      const bets = betsSnapshot.docs.map((snapshotDoc) => snapshotDoc.data());
      const refunds = calculateRefundsByUser(bets);

      const marketDoc = await getDoc(doc(db, 'markets', marketId));
      const marketQuestion = marketDoc.data().question;

      const batch = writeBatch(db);

      for (const [userId, refundAmount] of Object.entries(refunds)) {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) continue;

        const userData = userSnap.data();
        batch.update(userRef, {
          weeklyRep: round2((userData.weeklyRep || 0) + refundAmount)
        });

        batch.set(doc(collection(db, 'notifications')), {
          userId,
          type: 'refund',
          marketId,
          marketQuestion,
          amount: refundAmount,
          read: false,
          createdAt: new Date()
        });
      }

      batch.update(doc(db, 'markets', marketId), {
        status: MARKET_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason.trim() || null,
        lockedAt: null
      });

      await batch.commit();
      alert('Market cancelled. Refunds distributed.');
      await fetchUnresolvedMarkets();
    } catch (error) {
      console.error('Error cancelling market:', error);
      alert('Error cancelling market. Check console.');
    } finally {
      setCancelling(null);
    }
  }

  if (loading) return <div className="p-8 bg-brand-red text-white min-h-screen">Loading...</div>;
  if (!user) return <div className="p-8 bg-brand-red text-white min-h-screen">Access denied</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto bg-brand-red min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-white">Admin Panel</h1>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-yellow-800">
          <strong>Admin mode:</strong> Resolve, lock, unlock, or cancel markets. Resolving and cancelling are permanent.
        </p>
      </div>

      <div className="bg-white border-2 border-brand-pink rounded-lg p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Create New Market</h2>
          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-brand-red text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-darkred transition-colors"
            >
              + New Market
            </button>
          )}
        </div>

        {showCreateForm && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Market Question</label>
              <input
                type="text"
                value={newMarketQuestion}
                onChange={(e) => setNewMarketQuestion(e.target.value)}
                placeholder="Will Cornell have a snow day this month?"
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-brand-red focus:border-transparent text-gray-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Initial Probability (%)</label>
                <input
                  type="number"
                  value={initialProbability}
                  onChange={(e) => setInitialProbability(Number(e.target.value))}
                  min="1"
                  max="99"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-brand-red focus:border-transparent text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">Liquidity (b)</label>
                <input
                  type="number"
                  value={bValue}
                  onChange={(e) => setBValue(Number(e.target.value))}
                  min="10"
                  max="1000"
                  step="10"
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-brand-red focus:border-transparent text-gray-900"
                />
              </div>
            </div>

            <p className="text-xs text-gray-600">This market will open at {initialProbability}% and start in status OPEN.</p>

            <div className="flex gap-3">
              <button
                onClick={handleCreateMarket}
                disabled={creating || !newMarketQuestion.trim()}
                className="flex-1 bg-green-500 text-white py-2 px-4 rounded-lg font-semibold hover:bg-green-600 disabled:bg-gray-300"
              >
                {creating ? 'Creating...' : 'Create Market'}
              </button>

              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewMarketQuestion('');
                  setInitialProbability(50);
                  setBValue(100);
                }}
                disabled={creating}
                className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-semibold hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border-2 border-yellow-300 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900">Incoming Requests ({requests.length})</h2>

        {requests.length === 0 ? (
          <p className="text-gray-600">No pending requests.</p>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const edit = requestEdits[request.id] || request;
              const isEditing = editingRequestId === request.id;
              return (
                <div key={request.id} className="rounded-lg border border-gray-200 p-4">
                  {isEditing ? (
                    <div className="space-y-3">
                      <input
                        value={edit.question || ''}
                        onChange={(e) => setRequestEdits((prev) => ({ ...prev, [request.id]: { ...edit, question: e.target.value } }))}
                        className="w-full rounded border px-3 py-2 text-gray-900"
                      />
                      <div className="grid md:grid-cols-2 gap-3">
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={edit.initialProbability || 50}
                          onChange={(e) => setRequestEdits((prev) => ({ ...prev, [request.id]: { ...edit, initialProbability: Number(e.target.value) } }))}
                          className="w-full rounded border px-3 py-2 text-gray-900"
                        />
                        <input
                          type="number"
                          min="10"
                          max="1000"
                          step="10"
                          value={edit.liquidityB || 100}
                          onChange={(e) => setRequestEdits((prev) => ({ ...prev, [request.id]: { ...edit, liquidityB: Number(e.target.value) } }))}
                          className="w-full rounded border px-3 py-2 text-gray-900"
                        />
                      </div>
                      <textarea
                        value={edit.resolutionRules || ''}
                        onChange={(e) => setRequestEdits((prev) => ({ ...prev, [request.id]: { ...edit, resolutionRules: e.target.value } }))}
                        className="w-full rounded border px-3 py-2 text-gray-900"
                        rows={3}
                      />
                      <input
                        type="date"
                        value={edit.resolutionDate || ''}
                        onChange={(e) => setRequestEdits((prev) => ({ ...prev, [request.id]: { ...edit, resolutionDate: e.target.value } }))}
                        className="w-full rounded border px-3 py-2 text-gray-900"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="font-semibold text-gray-900">{request.question}</p>
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800">PENDING</span>
                      </div>
                      <p className="text-sm text-gray-700 mb-1">Requested by: {request.submitterDisplayName || request.submittedBy}</p>
                      <p className="text-sm text-gray-700 mb-1">Initial probability: {request.initialProbability}%</p>
                      <p className="text-sm text-gray-700 mb-1">Liquidity b: {request.liquidityB}</p>
                      <p className="text-sm text-gray-700 mb-1">Resolution date: {request.resolutionDate?.toDate?.()?.toLocaleDateString() || 'N/A'}</p>
                      <p className="text-sm text-gray-700"><span className="font-semibold">Rules:</span> {request.resolutionRules}</p>
                    </>
                  )}

                  <div className="flex flex-wrap gap-2 mt-3">
                    {!isEditing ? (
                      <button
                        onClick={() => startEditingRequest(request)}
                        className="bg-gray-200 text-gray-800 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-gray-300"
                      >
                        Edit
                      </button>
                    ) : (
                      <button
                        onClick={() => saveRequestEdits(request.id)}
                        disabled={processingRequestId === request.id}
                        className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300"
                      >
                        Save edits
                      </button>
                    )}

                    <button
                      onClick={() => handleApproveRequest(request)}
                      disabled={processingRequestId === request.id}
                      className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:bg-gray-300"
                    >
                      {processingRequestId === request.id ? 'Working...' : 'Approve + Create'}
                    </button>

                    <button
                      onClick={() => handleRejectRequest(request.id)}
                      disabled={processingRequestId === request.id}
                      className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:bg-gray-300"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <h2 className="text-xl font-semibold mb-4 text-white">Open or Locked Markets ({markets.length})</h2>

      {markets.length === 0 ? (
        <p className="text-white">No unresolved markets. <Link href="/" className="text-brand-lightpink hover:underline">View all markets</Link></p>
      ) : (
        <div className="space-y-4">
          {markets.map((market) => {
            const status = getMarketStatus(market);
            const isLocked = status === MARKET_STATUS.LOCKED;

            return (
              <div key={market.id} className="bg-white border-2 border-brand-pink rounded-lg p-6">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">{market.question}</h3>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${isLocked ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                    {status}
                  </span>
                </div>

                <p className="text-sm text-gray-600 mb-4">Current probability: {Math.round((market.probability || 0) * 100)}%</p>

                <div className="grid gap-2 md:grid-cols-4">
                  <button
                    onClick={() => handleResolve(market.id, 'YES')}
                    disabled={resolving === market.id || cancelling === market.id}
                    className="bg-green-500 text-white py-2 px-3 rounded-lg font-semibold hover:bg-green-600 disabled:bg-gray-300"
                  >
                    {resolving === market.id ? 'Resolving...' : 'Resolve YES'}
                  </button>

                  <button
                    onClick={() => handleResolve(market.id, 'NO')}
                    disabled={resolving === market.id || cancelling === market.id}
                    className="bg-red-500 text-white py-2 px-3 rounded-lg font-semibold hover:bg-red-600 disabled:bg-gray-300"
                  >
                    {resolving === market.id ? 'Resolving...' : 'Resolve NO'}
                  </button>

                  <button
                    onClick={() => handleToggleLock(market, isLocked ? MARKET_STATUS.OPEN : MARKET_STATUS.LOCKED)}
                    disabled={locking === market.id || resolving === market.id || cancelling === market.id}
                    className="bg-yellow-500 text-white py-2 px-3 rounded-lg font-semibold hover:bg-yellow-600 disabled:bg-gray-300"
                  >
                    {locking === market.id ? 'Saving...' : isLocked ? 'Unlock Market' : 'Lock Market'}
                  </button>

                  <button
                    onClick={() => handleCancelAndRefund(market.id)}
                    disabled={cancelling === market.id || resolving === market.id}
                    className="bg-gray-700 text-white py-2 px-3 rounded-lg font-semibold hover:bg-gray-800 disabled:bg-gray-300"
                  >
                    {cancelling === market.id ? 'Cancelling...' : 'Cancel + Refund'}
                  </button>
                </div>

                <Link href={`/market/${market.id}`} className="block mt-3 text-sm text-brand-red hover:underline text-center font-semibold">
                  View market details →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
