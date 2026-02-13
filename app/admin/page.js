'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import { calculateRefundsByUser, round2 } from '@/utils/refunds';
import { getPublicDisplayName } from '@/utils/displayName';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];
const SECTIONS = ['Overview', 'Markets', 'Requests', 'Users', 'Moderation'];

const ACTION_BUTTON_BASE =
  'font-mono text-[0.68rem] uppercase tracking-[0.06em] rounded-[4px] px-4 py-2 border transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
const INPUT_CLASS =
  'w-full rounded-[5px] border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 font-mono text-[0.78rem] text-[var(--text)] focus:outline-none focus:border-[var(--red)]';

const BTN_GREEN = `${ACTION_BUTTON_BASE} bg-[rgba(22,163,74,0.15)] text-[var(--green-bright)] border-[rgba(22,163,74,0.25)] hover:bg-[rgba(22,163,74,0.25)]`;
const BTN_RED = `${ACTION_BUTTON_BASE} bg-[var(--red-glow)] text-[var(--red)] border-[rgba(220,38,38,0.3)] hover:bg-[rgba(220,38,38,0.15)]`;
const BTN_AMBER = `${ACTION_BUTTON_BASE} bg-[rgba(217,119,6,0.15)] text-[var(--amber-bright)] border-[rgba(217,119,6,0.25)] hover:bg-[rgba(217,119,6,0.25)]`;
const BTN_NEUTRAL = `${ACTION_BUTTON_BASE} bg-[var(--surface2)] text-[var(--text-dim)] border-[var(--border2)] hover:bg-[var(--surface3)]`;

function toDate(value) {
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatDateTime(value) {
  if (!value) return '—';
  return toDate(value).toLocaleString();
}

function formatDate(value) {
  if (!value) return '—';
  return toDate(value).toLocaleDateString();
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function isPastDateString(dateString) {
  const picked = new Date(`${dateString}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return picked < today;
}

function getStatusBadgeStyle(status) {
  const base = {
    borderRadius: '3px',
    border: '1px solid var(--border2)',
    background: 'var(--surface2)',
    color: 'var(--text-muted)'
  };

  if (status === MARKET_STATUS.OPEN) {
    return {
      ...base,
      border: '1px solid rgba(22,163,74,0.25)',
      background: 'rgba(22,163,74,0.12)',
      color: 'var(--green-bright)'
    };
  }

  if (status === MARKET_STATUS.LOCKED) {
    return {
      ...base,
      border: '1px solid rgba(217,119,6,0.25)',
      background: 'rgba(217,119,6,0.14)',
      color: 'var(--amber-bright)'
    };
  }

  if (status === MARKET_STATUS.RESOLVED) {
    return {
      ...base,
      border: '1px solid var(--border2)',
      background: 'var(--surface)',
      color: 'var(--text-dim)'
    };
  }

  return base;
}

function getActionBadgeClass(action) {
  const base =
    'rounded-[3px] border px-2 py-1 font-mono text-[0.56rem] uppercase tracking-[0.06em]';
  if (action === 'CREATE') {
    return `${base} border-[rgba(22,163,74,0.25)] bg-[rgba(22,163,74,0.12)] text-[var(--green-bright)]`;
  }
  if (action === 'RESOLVE') {
    return `${base} border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.14)] text-[var(--amber-bright)]`;
  }
  if (action === 'DELETE') {
    return `${base} border-[rgba(220,38,38,0.3)] bg-[var(--red-glow)] text-[var(--red)]`;
  }
  return `${base} border-[var(--border2)] bg-[var(--surface2)] text-[var(--text-dim)]`;
}

async function commitOperationChunks(operationFns, chunkSize = 400) {
  for (let i = 0; i < operationFns.length; i += chunkSize) {
    const batch = writeBatch(db);
    const chunk = operationFns.slice(i, i + chunkSize);
    chunk.forEach((applyOp) => applyOp(batch));
    await batch.commit();
  }
}

export default function AdminPage() {
  const router = useRouter();
  const { toasts, notifySuccess, notifyError, confirmToast, removeToast, resolveConfirm } = useToastQueue();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const [activeSection, setActiveSection] = useState('Overview');
  const [marketTab, setMarketTab] = useState('Active');
  const [moderationTab, setModerationTab] = useState('Comments');

  const [markets, setMarkets] = useState([]);
  const [resolvedMarkets, setResolvedMarkets] = useState([]);
  const [marketStatsById, setMarketStatsById] = useState({});
  const [expandedMarketBets, setExpandedMarketBets] = useState({});
  const [marketBetsByMarket, setMarketBetsByMarket] = useState({});
  const [loadingBetsByMarket, setLoadingBetsByMarket] = useState({});

  const [requests, setRequests] = useState([]);
  const [editingRequestId, setEditingRequestId] = useState(null);
  const [requestEdits, setRequestEdits] = useState({});
  const [processingRequestId, setProcessingRequestId] = useState(null);
  const [rejectingRequestId, setRejectingRequestId] = useState(null);
  const [rejectReasons, setRejectReasons] = useState({});

  const [usersData, setUsersData] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [editingUserId, setEditingUserId] = useState(null);
  const [userEdits, setUserEdits] = useState({});
  const [savingUserId, setSavingUserId] = useState(null);
  const [expandedUsers, setExpandedUsers] = useState({});
  const [userBetCounts, setUserBetCounts] = useState({});
  const [loadingUserBetCounts, setLoadingUserBetCounts] = useState({});
  const [resetting, setResetting] = useState(false);

  const [commentsModeration, setCommentsModeration] = useState([]);
  const [newsModeration, setNewsModeration] = useState([]);
  const [loadingModeration, setLoadingModeration] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [deletingNewsId, setDeletingNewsId] = useState(null);

  const [marketQuestionMap, setMarketQuestionMap] = useState({});
  const [userNameCache, setUserNameCache] = useState({});

  const [overviewStats, setOverviewStats] = useState({
    totalMarkets: 0,
    openMarkets: 0,
    totalUsers: 0,
    totalVolume: 0
  });
  const [adminLog, setAdminLog] = useState([]);

  const [resolving, setResolving] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [locking, setLocking] = useState(null);
  const [deletingMarketId, setDeletingMarketId] = useState(null);
  const [refundingBetId, setRefundingBetId] = useState(null);
  const [editingQuestionMarketId, setEditingQuestionMarketId] = useState(null);
  const [questionDrafts, setQuestionDrafts] = useState({});

  const [newMarketQuestion, setNewMarketQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [initialProbability, setInitialProbability] = useState(50);
  const [bValue, setBValue] = useState(100);
  const [newsDrafts, setNewsDrafts] = useState({});
  const [cancelReasonsByMarket, setCancelReasonsByMarket] = useState({});

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    const rows = [...usersData].sort((a, b) => Number(b.weeklyRep || 0) - Number(a.weeklyRep || 0));
    if (!term) return rows;
    return rows.filter((entry) => (entry.email || '').toLowerCase().startsWith(term));
  }, [usersData, userSearch]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      if (!ADMIN_EMAILS.includes(currentUser.email)) {
        notifyError('Access denied. Admin only.');
        router.push('/');
        return;
      }

      setUser(currentUser);
      await Promise.all([
        fetchUnresolvedMarkets(),
        fetchResolvedMarkets(),
        fetchPendingRequests(),
        fetchOverviewStats(),
        fetchAdminLog(),
        fetchUsers()
      ]);
      setLoading(false);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, notifyError]);

  useEffect(() => {
    if (activeSection !== 'Moderation') return;
    if (moderationTab === 'Comments') {
      fetchModerationComments();
    } else {
      fetchModerationNews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, moderationTab]);

  async function fetchOverviewStats() {
    try {
      const [marketsSnap, usersSnap, betsSnap] = await Promise.all([
        getDocs(collection(db, 'markets')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'bets'))
      ]);

      const marketRows = marketsSnap.docs.map((snapshotDoc) => snapshotDoc.data());
      const openMarkets = marketRows.filter((market) => {
        const status = market.status;
        if (status === MARKET_STATUS.OPEN || status === MARKET_STATUS.LOCKED) return true;
        if (!status && market.resolution == null) return true;
        return false;
      }).length;

      const totalVolume = betsSnap.docs.reduce(
        (sum, snapshotDoc) => sum + Math.abs(Number(snapshotDoc.data().amount || 0)),
        0
      );

      setOverviewStats({
        totalMarkets: marketsSnap.size,
        openMarkets,
        totalUsers: usersSnap.size,
        totalVolume
      });
    } catch (error) {
      console.error('Error fetching overview stats:', error);
    }
  }

  async function fetchAdminLog() {
    try {
      const q = query(collection(db, 'adminLog'), orderBy('timestamp', 'desc'), limit(10));
      const snapshot = await getDocs(q);
      setAdminLog(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    } catch (error) {
      console.error('Error fetching admin log:', error);
    }
  }

  async function logAdminAction(action, detail) {
    if (!user?.email) return;
    try {
      await addDoc(collection(db, 'adminLog'), {
        action,
        detail,
        adminEmail: user.email,
        timestamp: serverTimestamp()
      });
      await fetchAdminLog();
    } catch (error) {
      console.error('Error writing admin log:', error);
    }
  }

  async function fetchMarketStatsForMarkets(marketRows) {
    try {
      const statsEntries = await Promise.all(
        marketRows.map(async (market) => {
          const betsQ = query(collection(db, 'bets'), where('marketId', '==', market.id));
          const betsSnap = await getDocs(betsQ);
          const totalVolume = betsSnap.docs.reduce(
            (sum, snapshotDoc) => sum + Math.abs(Number(snapshotDoc.data().amount || 0)),
            0
          );
          return [
            market.id,
            {
              betCount: betsSnap.size,
              totalVolume
            }
          ];
        })
      );
      setMarketStatsById((prev) => ({ ...prev, ...Object.fromEntries(statsEntries) }));
    } catch (error) {
      console.error('Error fetching market stats:', error);
    }
  }

  async function fetchUnresolvedMarkets() {
    try {
      const q = query(collection(db, 'markets'), where('resolution', '==', null));
      const snapshot = await getDocs(q);
      const marketData = snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((market) => {
          const status = getMarketStatus(market);
          return status === MARKET_STATUS.OPEN || status === MARKET_STATUS.LOCKED;
        })
        .sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime?.() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime?.() || 0;
          return bTime - aTime;
        });

      setMarkets(marketData);
      await fetchMarketStatsForMarkets(marketData);
    } catch (error) {
      console.error('Error fetching active markets:', error);
    }
  }

  async function fetchResolvedMarkets() {
    try {
      const [yesSnap, noSnap] = await Promise.all([
        getDocs(query(collection(db, 'markets'), where('resolution', '==', 'YES'))),
        getDocs(query(collection(db, 'markets'), where('resolution', '==', 'NO')))
      ]);

      const rows = [...yesSnap.docs, ...noSnap.docs]
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .sort((a, b) => {
          const aTime = a.resolvedAt?.toDate?.()?.getTime?.() || 0;
          const bTime = b.resolvedAt?.toDate?.()?.getTime?.() || 0;
          return bTime - aTime;
        });

      setResolvedMarkets(rows);
    } catch (error) {
      console.error('Error fetching resolved markets:', error);
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

  async function fetchUsers() {
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const rows = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      setUsersData(rows);

      const cacheEntries = rows.map((entry) => [entry.id, getPublicDisplayName(entry)]);
      setUserNameCache((prev) => ({ ...prev, ...Object.fromEntries(cacheEntries) }));
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }

  async function ensureUserNames(userIds) {
    const unique = [...new Set(userIds.filter(Boolean))];
    const missing = unique.filter((id) => !userNameCache[id]);
    if (missing.length === 0) return userNameCache;

    const loaded = {};
    await Promise.all(
      missing.map(async (userId) => {
        try {
          const userSnap = await getDoc(doc(db, 'users', userId));
          if (userSnap.exists()) {
            loaded[userId] = getPublicDisplayName({ id: userId, ...userSnap.data() });
          } else {
            loaded[userId] = 'Unknown';
          }
        } catch (error) {
          console.error('Error loading user name:', error);
          loaded[userId] = 'Unknown';
        }
      })
    );

    const merged = { ...userNameCache, ...loaded };
    setUserNameCache((prev) => ({ ...prev, ...loaded }));
    return merged;
  }

  async function ensureMarketQuestions(marketIds) {
    const unique = [...new Set(marketIds.filter(Boolean))];
    const missing = unique.filter((marketId) => !marketQuestionMap[marketId]);
    if (missing.length === 0) return;

    const loaded = {};
    await Promise.all(
      missing.map(async (marketId) => {
        try {
          const marketSnap = await getDoc(doc(db, 'markets', marketId));
          loaded[marketId] = marketSnap.exists() ? marketSnap.data().question || 'Unknown market' : 'Unknown market';
        } catch (error) {
          console.error('Error loading market question:', error);
          loaded[marketId] = 'Unknown market';
        }
      })
    );

    setMarketQuestionMap((prev) => ({ ...prev, ...loaded }));
  }

  async function createMarket({ question, probabilityPercent, liquidityB }) {
    const probDecimal = probabilityPercent / 100;
    const b = liquidityB;
    const qYes = b * Math.log(probDecimal / (1 - probDecimal));

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
      notifyError('Please enter a question');
      return;
    }

    if (initialProbability < 1 || initialProbability > 99) {
      notifyError('Probability must be between 1% and 99%');
      return;
    }

    setCreating(true);
    try {
      await createMarket({
        question: newMarketQuestion,
        probabilityPercent: initialProbability,
        liquidityB: bValue
      });

      await logAdminAction('CREATE', `Market created: ${newMarketQuestion.trim().slice(0, 120)}`);
      notifySuccess('Market created successfully.');
      setNewMarketQuestion('');
      setInitialProbability(50);
      setBValue(100);
      await Promise.all([fetchUnresolvedMarkets(), fetchOverviewStats()]);
    } catch (error) {
      console.error('Error creating market:', error);
      notifyError('Error creating market. Check console.');
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
      notifyError('Please keep required request fields filled.');
      return;
    }

    if (edit.initialProbability < 1 || edit.initialProbability > 99) {
      notifyError('Initial probability must be between 1% and 99%.');
      return;
    }

    if (isPastDateString(edit.resolutionDate)) {
      notifyError('Resolution date cannot be in the past.');
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

      await logAdminAction('EDIT', `Market request ${requestId} edited before review.`);
      setEditingRequestId(null);
      await fetchPendingRequests();
    } catch (error) {
      console.error('Error saving request edit:', error);
      notifyError('Could not save edits.');
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
      notifyError('Request must include question, rules, and resolution date before approval.');
      return;
    }

    if (isPastDateString(edit.resolutionDate)) {
      notifyError('Resolution date cannot be in the past.');
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

      await logAdminAction('CREATE', `Request approved and market published: ${edit.question.trim().slice(0, 120)}`);
      setEditingRequestId(null);
      await Promise.all([fetchUnresolvedMarkets(), fetchPendingRequests(), fetchOverviewStats()]);
      notifySuccess('Request approved and market created.');
    } catch (error) {
      console.error('Error approving request:', error);
      notifyError('Error approving request.');
    } finally {
      setProcessingRequestId(null);
    }
  }

  async function handleRejectRequest(requestId, reason) {
    if (!reason || !reason.trim()) {
      notifyError('A rejection reason is required.');
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

      await logAdminAction('EDIT', `Request ${requestId} rejected. Reason: ${reason.trim().slice(0, 120)}`);
      setRejectingRequestId(null);
      setRejectReasons((prev) => ({ ...prev, [requestId]: '' }));
      await fetchPendingRequests();
      notifySuccess('Request rejected.');
    } catch (error) {
      console.error('Error rejecting request:', error);
      notifyError('Error rejecting request.');
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
      await logAdminAction('EDIT', `Market ${market.id} ${nextStatus === MARKET_STATUS.LOCKED ? 'locked' : 'unlocked'}.`);
      await Promise.all([fetchUnresolvedMarkets(), fetchOverviewStats()]);
    } catch (error) {
      console.error('Error locking market:', error);
      notifyError('Error updating lock state.');
    } finally {
      setLocking(null);
    }
  }

  async function handleResolve(marketId, resolution) {
    if (!(await confirmToast(`Resolve this market as ${resolution}?`))) {
      return;
    }

    setResolving(marketId);
    try {
      const betsQuery = query(collection(db, 'bets'), where('marketId', '==', marketId));
      const betsSnapshot = await getDocs(betsQuery);

      const userAdjustments = {};
      betsSnapshot.docs.forEach((betDoc) => {
        const bet = betDoc.data();
        if (!userAdjustments[bet.userId]) {
          userAdjustments[bet.userId] = { payout: 0, lostInvestment: 0 };
        }

        if (bet.side === resolution) {
          userAdjustments[bet.userId].payout = round2(
            userAdjustments[bet.userId].payout + round2(bet.shares)
          );
        } else if (bet.amount > 0) {
          userAdjustments[bet.userId].lostInvestment = round2(
            userAdjustments[bet.userId].lostInvestment + round2(bet.amount)
          );
        }
      });

      const marketDoc = await getDoc(doc(db, 'markets', marketId));
      const marketQuestion = marketDoc.exists() ? marketDoc.data().question : 'Market';

      const operationFns = [];

      for (const [userId, adj] of Object.entries(userAdjustments)) {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) continue;

        const userData = userSnap.data();
        const newWeeklyRep = round2(Number(userData.weeklyRep || 0) + adj.payout);
        const currentLifetime = Number(userData.lifetimeRep) || 0;
        const newLifetimeRep = round2(currentLifetime + adj.payout - adj.lostInvestment);

        operationFns.push((batch) => {
          batch.update(userRef, {
            weeklyRep: newWeeklyRep,
            lifetimeRep: newLifetimeRep
          });
        });

        if (adj.payout > 0) {
          operationFns.push((batch) => {
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
          });
        }

        if (adj.lostInvestment > 0) {
          operationFns.push((batch) => {
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
          });
        }
      }

      operationFns.push((batch) => {
        batch.update(doc(db, 'markets', marketId), {
          status: MARKET_STATUS.RESOLVED,
          resolution,
          resolvedAt: new Date()
        });
      });

      await commitOperationChunks(operationFns);

      await logAdminAction('RESOLVE', `Market resolved as ${resolution}: ${marketQuestion}`);
      notifySuccess(`Market resolved as ${resolution}. Payouts distributed.`);
      await Promise.all([
        fetchUnresolvedMarkets(),
        fetchResolvedMarkets(),
        fetchOverviewStats()
      ]);
    } catch (error) {
      console.error('Error resolving market:', error);
      notifyError('Error resolving market. Check console.');
    } finally {
      setResolving(null);
    }
  }

  async function handleCancelAndRefund(marketId) {
    if (!(await confirmToast('Cancel this market and issue full refunds of net invested amounts?'))) {
      return;
    }

    const reason = (cancelReasonsByMarket[marketId] || '').trim();
    setCancelling(marketId);

    try {
      const betsQuery = query(collection(db, 'bets'), where('marketId', '==', marketId));
      const betsSnapshot = await getDocs(betsQuery);
      const bets = betsSnapshot.docs.map((snapshotDoc) => snapshotDoc.data());
      const refunds = calculateRefundsByUser(bets);

      const marketDoc = await getDoc(doc(db, 'markets', marketId));
      const marketQuestion = marketDoc.exists() ? marketDoc.data().question : 'Market';

      const operationFns = [];

      for (const [userId, refundAmount] of Object.entries(refunds)) {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) continue;

        const userData = userSnap.data();
        operationFns.push((batch) => {
          batch.update(userRef, {
            weeklyRep: round2((userData.weeklyRep || 0) + refundAmount),
            lifetimeRep: Number(userData.lifetimeRep) || 0
          });
        });

        operationFns.push((batch) => {
          batch.set(doc(collection(db, 'notifications')), {
            userId,
            type: 'refund',
            marketId,
            marketQuestion,
            amount: refundAmount,
            read: false,
            createdAt: new Date()
          });
        });
      }

      operationFns.push((batch) => {
        batch.update(doc(db, 'markets', marketId), {
          status: MARKET_STATUS.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: reason || null,
          lockedAt: null
        });
      });

      await commitOperationChunks(operationFns);

      await logAdminAction(
        'DELETE',
        `Market cancelled and refunded: ${marketQuestion}${reason ? ` (reason: ${reason.slice(0, 120)})` : ''}`
      );
      notifySuccess('Market cancelled. Refunds distributed.');
      setCancelReasonsByMarket((prev) => ({ ...prev, [marketId]: '' }));

      await Promise.all([
        fetchUnresolvedMarkets(),
        fetchResolvedMarkets(),
        fetchOverviewStats()
      ]);
    } catch (error) {
      console.error('Error cancelling market:', error);
      notifyError('Error cancelling market. Check console.');
    } finally {
      setCancelling(null);
    }
  }

  async function handlePostNews(market) {
    const draft = newsDrafts[market.id] || {};
    if (!draft.headline?.trim() || !draft.url?.trim() || !draft.source?.trim()) {
      notifyError('News post requires headline, URL, and source.');
      return;
    }

    try {
      await addDoc(collection(db, 'newsItems'), {
        marketId: market.id,
        adminId: user.uid,
        headline: draft.headline.trim(),
        url: draft.url.trim(),
        source: draft.source.trim(),
        timestamp: new Date(),
        probabilityAtPost: Number(market.probability || 0)
      });

      await logAdminAction('CREATE', `News posted on market ${market.id}: ${draft.headline.trim().slice(0, 120)}`);
      setNewsDrafts((prev) => ({ ...prev, [market.id]: { headline: '', url: '', source: '' } }));
      notifySuccess('News item posted.');
    } catch (error) {
      console.error('Error posting news:', error);
      notifyError('Could not post news item.');
    }
  }

  function beginEditQuestion(market) {
    setEditingQuestionMarketId(market.id);
    setQuestionDrafts((prev) => ({ ...prev, [market.id]: market.question || '' }));
  }

  async function handleEditQuestion(marketId, currentQuestion) {
    const nextQuestion = (questionDrafts[marketId] ?? currentQuestion ?? '').trim();
    if (!nextQuestion) {
      notifyError('Question cannot be empty.');
      return;
    }

    try {
      await updateDoc(doc(db, 'markets', marketId), { question: nextQuestion });
      await logAdminAction('EDIT', `Question updated on market ${marketId}`);

      setMarkets((prev) => prev.map((market) => (market.id === marketId ? { ...market, question: nextQuestion } : market)));
      setResolvedMarkets((prev) => prev.map((market) => (market.id === marketId ? { ...market, question: nextQuestion } : market)));
      setEditingQuestionMarketId(null);
      notifySuccess('Question updated.');
    } catch (error) {
      console.error('Error updating question:', error);
      notifyError('Could not update question.');
    }
  }

  async function handlePermanentDelete(marketId) {
    if (
      !(await confirmToast(
        'Permanently delete this market and ALL associated bets, comments, and news items? This cannot be undone.'
      ))
    ) {
      return;
    }

    setDeletingMarketId(marketId);
    try {
      const marketRef = doc(db, 'markets', marketId);
      const marketSnap = await getDoc(marketRef);
      if (!marketSnap.exists()) {
        notifyError('Market not found.');
        return;
      }

      const marketQuestion = marketSnap.data().question || marketId;

      const [betsSnap, commentsSnap, newsSnap, notificationsSnap] = await Promise.all([
        getDocs(query(collection(db, 'bets'), where('marketId', '==', marketId))),
        getDocs(query(collection(db, 'comments'), where('marketId', '==', marketId))),
        getDocs(query(collection(db, 'newsItems'), where('marketId', '==', marketId))),
        getDocs(query(collection(db, 'notifications'), where('marketId', '==', marketId)))
      ]);

      const bets = betsSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      const refunds = calculateRefundsByUser(bets);

      const operationFns = [];

      for (const [userId, refundAmount] of Object.entries(refunds)) {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) continue;

        const userData = userSnap.data();

        operationFns.push((batch) => {
          batch.update(userRef, {
            weeklyRep: round2(Number(userData.weeklyRep || 0) + refundAmount)
          });
        });

        operationFns.push((batch) => {
          batch.set(doc(collection(db, 'notifications')), {
            userId,
            type: 'refund',
            marketId,
            marketQuestion,
            amount: round2(refundAmount),
            read: false,
            createdAt: new Date()
          });
        });
      }

      betsSnap.docs.forEach((snapshotDoc) => {
        operationFns.push((batch) => {
          batch.delete(doc(db, 'bets', snapshotDoc.id));
        });
      });

      commentsSnap.docs.forEach((snapshotDoc) => {
        operationFns.push((batch) => {
          batch.delete(doc(db, 'comments', snapshotDoc.id));
        });
      });

      newsSnap.docs.forEach((snapshotDoc) => {
        operationFns.push((batch) => {
          batch.delete(doc(db, 'newsItems', snapshotDoc.id));
        });
      });

      notificationsSnap.docs.forEach((snapshotDoc) => {
        operationFns.push((batch) => {
          batch.delete(doc(db, 'notifications', snapshotDoc.id));
        });
      });

      operationFns.push((batch) => {
        batch.delete(marketRef);
      });

      await commitOperationChunks(operationFns);

      await logAdminAction('DELETE', `Market deleted: ${marketQuestion}`);
      notifySuccess('Market permanently deleted.');

      setMarkets((prev) => prev.filter((market) => market.id !== marketId));
      setResolvedMarkets((prev) => prev.filter((market) => market.id !== marketId));
      setExpandedMarketBets((prev) => ({ ...prev, [marketId]: false }));
      setMarketBetsByMarket((prev) => {
        const next = { ...prev };
        delete next[marketId];
        return next;
      });

      await Promise.all([fetchOverviewStats(), fetchUnresolvedMarkets(), fetchResolvedMarkets()]);
    } catch (error) {
      console.error('Error permanently deleting market:', error);
      notifyError('Could not permanently delete market.');
    } finally {
      setDeletingMarketId(null);
    }
  }

  async function handleViewBets(marketId) {
    setExpandedMarketBets((prev) => ({ ...prev, [marketId]: !prev[marketId] }));

    if (marketBetsByMarket[marketId]) {
      return;
    }

    setLoadingBetsByMarket((prev) => ({ ...prev, [marketId]: true }));
    try {
      let betsSnap;
      try {
        betsSnap = await getDocs(
          query(
            collection(db, 'bets'),
            where('marketId', '==', marketId),
            orderBy('timestamp', 'desc')
          )
        );
      } catch {
        betsSnap = await getDocs(query(collection(db, 'bets'), where('marketId', '==', marketId)));
      }

      const rows = betsSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      rows.sort((a, b) => toDate(b.timestamp).getTime() - toDate(a.timestamp).getTime());

      const userIds = rows.map((entry) => entry.userId);
      const names = (await ensureUserNames(userIds)) || userNameCache;

      setMarketBetsByMarket((prev) => ({
        ...prev,
        [marketId]: rows.map((entry) => ({
          ...entry,
          userName: names[entry.userId] || userNameCache[entry.userId] || 'Unknown'
        }))
      }));
    } catch (error) {
      console.error('Error fetching market bets:', error);
      notifyError('Could not load market bets.');
    } finally {
      setLoadingBetsByMarket((prev) => ({ ...prev, [marketId]: false }));
    }
  }

  async function handleRefundSingleBet(bet) {
    if (bet.type !== 'BUY') {
      notifyError('Only BUY bets can be refunded individually.');
      return;
    }

    if (bet.refunded) {
      notifyError('This bet has already been refunded.');
      return;
    }

    if (!(await confirmToast(`Refund ${formatMoney(bet.amount)} to this user for this bet?`))) {
      return;
    }

    setRefundingBetId(bet.id);
    try {
      const userRef = doc(db, 'users', bet.userId);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        notifyError('User not found for this bet.');
        return;
      }

      const userData = userSnap.data();
      const refundAmount = Number(bet.amount || 0);
      const nextWeekly = round2(Number(userData.weeklyRep || 0) + refundAmount);

      await updateDoc(userRef, { weeklyRep: nextWeekly });
      await updateDoc(doc(db, 'bets', bet.id), {
        refunded: true,
        refundedAt: new Date(),
        refundedBy: user.email
      });

      await addDoc(collection(db, 'notifications'), {
        userId: bet.userId,
        type: 'refund',
        marketId: bet.marketId,
        amount: refundAmount,
        message: 'An admin refunded one of your bets.',
        read: false,
        createdAt: new Date()
      });

      await logAdminAction('EDIT', `Single bet refunded: ${bet.id} (${formatMoney(refundAmount)})`);

      setMarketBetsByMarket((prev) => {
        const next = { ...prev };
        const rows = next[bet.marketId] || [];
        next[bet.marketId] = rows.map((row) =>
          row.id === bet.id ? { ...row, refunded: true, refundedAt: new Date() } : row
        );
        return next;
      });

      notifySuccess('Bet refunded and marked as refunded.');
      await Promise.all([fetchUsers(), fetchOverviewStats()]);
    } catch (error) {
      console.error('Error refunding single bet:', error);
      notifyError('Could not refund this bet.');
    } finally {
      setRefundingBetId(null);
    }
  }

  async function loadUserBetCount(userId) {
    if (userBetCounts[userId] !== undefined) return;

    setLoadingUserBetCounts((prev) => ({ ...prev, [userId]: true }));
    try {
      const betsSnap = await getDocs(query(collection(db, 'bets'), where('userId', '==', userId)));
      setUserBetCounts((prev) => ({ ...prev, [userId]: betsSnap.size }));
    } catch (error) {
      console.error('Error loading user bet count:', error);
      notifyError('Could not load user bet count.');
    } finally {
      setLoadingUserBetCounts((prev) => ({ ...prev, [userId]: false }));
    }
  }

  function startEditingUser(entry) {
    setEditingUserId(entry.id);
    setUserEdits((prev) => ({
      ...prev,
      [entry.id]: {
        weeklyRep: Number(entry.weeklyRep || 0),
        lifetimeRep: Number(entry.lifetimeRep || 0),
        reason: ''
      }
    }));
  }

  async function handleSaveUserEdit(entry) {
    const draft = userEdits[entry.id];
    if (!draft) return;

    const weeklyRep = Number(draft.weeklyRep);
    const lifetimeRep = Number(draft.lifetimeRep);
    const reason = (draft.reason || '').trim();

    if (!Number.isFinite(weeklyRep) || !Number.isFinite(lifetimeRep)) {
      notifyError('Weekly and lifetime values must be valid numbers.');
      return;
    }

    if (!reason) {
      notifyError('Reason is required for user edits.');
      return;
    }

    setSavingUserId(entry.id);
    try {
      await updateDoc(doc(db, 'users', entry.id), {
        weeklyRep,
        lifetimeRep
      });

      await addDoc(collection(db, 'notifications'), {
        userId: entry.id,
        type: 'admin_adjustment',
        amount: round2(weeklyRep - Number(entry.weeklyRep || 0)),
        message: reason,
        read: false,
        createdAt: new Date()
      });

      await logAdminAction(
        'EDIT',
        `User ${entry.email || entry.id} balance set to $${weeklyRep} weekly, $${lifetimeRep} lifetime. Reason: ${reason}`
      );

      setUsersData((prev) =>
        prev.map((row) => (row.id === entry.id ? { ...row, weeklyRep, lifetimeRep } : row))
      );
      setEditingUserId(null);
      notifySuccess('User balances updated.');
      await fetchOverviewStats();
    } catch (error) {
      console.error('Error saving user edit:', error);
      notifyError('Could not update user balances.');
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleWeeklyReset() {
    if (!(await confirmToast(
      'Reset weekly leaderboard now? This sets all weekly balances to $1,000.00 for all users.'
    ))) return;

    setResetting(true);
    try {
      const snapshot = await getDocs(collection(db, 'users'));
      const batch = writeBatch(db);
      snapshot.docs.forEach((d) =>
        batch.update(doc(db, 'users', d.id), { weeklyRep: 1000 })
      );
      await batch.commit();
      notifySuccess('Weekly leaderboard reset. All balances set to $1,000.00.');
      await addDoc(collection(db, 'adminLog'), {
        action: 'RESET',
        detail: 'Weekly leaderboard reset — all users set to $1,000.00',
        adminEmail: user.email,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error resetting weekly leaderboard:', error);
      notifyError('Failed to reset weekly leaderboard.');
    } finally {
      setResetting(false);
    }
  }

  async function fetchModerationComments() {
    setLoadingModeration(true);
    try {
      const commentsQ = query(collection(db, 'comments'), orderBy('timestamp', 'desc'), limit(100));
      const snapshot = await getDocs(commentsQ);
      const rows = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      setCommentsModeration(rows);

      await ensureMarketQuestions(rows.map((row) => row.marketId));
    } catch (error) {
      console.error('Error fetching moderation comments:', error);
      notifyError('Could not load comments moderation data.');
    } finally {
      setLoadingModeration(false);
    }
  }

  async function fetchModerationNews() {
    setLoadingModeration(true);
    try {
      const newsQ = query(collection(db, 'newsItems'), orderBy('timestamp', 'desc'), limit(100));
      const snapshot = await getDocs(newsQ);
      const rows = snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      setNewsModeration(rows);

      await ensureMarketQuestions(rows.map((row) => row.marketId));
    } catch (error) {
      console.error('Error fetching moderation news:', error);
      notifyError('Could not load news moderation data.');
    } finally {
      setLoadingModeration(false);
    }
  }

  async function handleDeleteComment(comment) {
    if (!(await confirmToast('Delete this comment?'))) return;

    setDeletingCommentId(comment.id);
    try {
      await deleteDoc(doc(db, 'comments', comment.id));
      await logAdminAction('DELETE', `Comment deleted: "${String(comment.text || '').slice(0, 60)}..."`);
      setCommentsModeration((prev) => prev.filter((row) => row.id !== comment.id));
      notifySuccess('Comment deleted.');
    } catch (error) {
      console.error('Error deleting comment:', error);
      notifyError('Could not delete comment.');
    } finally {
      setDeletingCommentId(null);
    }
  }

  async function handleDeleteNewsItem(item) {
    if (!(await confirmToast('Delete this news item?'))) return;

    setDeletingNewsId(item.id);
    try {
      await deleteDoc(doc(db, 'newsItems', item.id));
      await logAdminAction('DELETE', `News item deleted: "${String(item.headline || '').slice(0, 60)}"`);
      setNewsModeration((prev) => prev.filter((row) => row.id !== item.id));
      notifySuccess('News item deleted.');
    } catch (error) {
      console.error('Error deleting news item:', error);
      notifyError('Could not delete news item.');
    } finally {
      setDeletingNewsId(null);
    }
  }

  function renderSectionNavButton(section) {
    const isActive = activeSection === section;
    return (
      <button
        key={section}
        onClick={() => setActiveSection(section)}
        className={`w-full border-l-2 px-4 py-2 text-left font-mono text-[0.65rem] uppercase tracking-[0.06em] transition-colors ${
          isActive
            ? 'border-[var(--red)] text-[var(--text)]'
            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-dim)]'
        }`}
      >
        {section}
      </button>
    );
  }

  function renderOverviewSection() {
    return (
      <div className="space-y-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">Total Markets</p>
            <p className="mt-2 font-mono text-3xl font-bold text-[var(--red)]">{overviewStats.totalMarkets}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">Open Markets</p>
            <p className="mt-2 font-mono text-3xl font-bold text-[var(--text)]">{overviewStats.openMarkets}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">Total Users</p>
            <p className="mt-2 font-mono text-3xl font-bold text-[var(--amber-bright)]">{overviewStats.totalUsers}</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">Total Volume</p>
            <p className="mt-2 font-mono text-3xl font-bold text-[var(--green-bright)]">{formatMoney(overviewStats.totalVolume)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="border-b border-[var(--border)] px-5 py-4">
            <p className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Recent Activity</p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {adminLog.length === 0 ? (
              <p className="px-5 py-4 font-mono text-[0.72rem] text-[var(--text-muted)]">No admin actions logged yet.</p>
            ) : (
              adminLog.map((entry) => (
                <div key={entry.id} className="grid items-center gap-3 px-5 py-3 md:grid-cols-[180px_auto_1fr]">
                  <span className="font-mono text-[0.6rem] text-[var(--text-muted)]">{formatDateTime(entry.timestamp)}</span>
                  <span className={getActionBadgeClass(entry.action)}>{entry.action || 'EDIT'}</span>
                  <span className="text-sm text-[var(--text-dim)]">{entry.detail || '—'}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderCreateMarketTab() {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Create New Market</p>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block font-mono text-[0.62rem] uppercase tracking-[0.05em] text-[var(--text-muted)]">Market Question</label>
            <input
              type="text"
              value={newMarketQuestion}
              onChange={(e) => setNewMarketQuestion(e.target.value)}
              placeholder="Will Cornell have a snow day this month?"
              className={INPUT_CLASS}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block font-mono text-[0.62rem] uppercase tracking-[0.05em] text-[var(--text-muted)]">Initial Probability (%)</label>
              <input
                type="number"
                value={initialProbability}
                onChange={(e) => setInitialProbability(Number(e.target.value))}
                min="1"
                max="99"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="mb-2 block font-mono text-[0.62rem] uppercase tracking-[0.05em] text-[var(--text-muted)]">Liquidity (b)</label>
              <input
                type="number"
                value={bValue}
                onChange={(e) => setBValue(Number(e.target.value))}
                min="10"
                max="1000"
                step="10"
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <p className="font-mono text-[0.62rem] text-[var(--text-dim)]">This market will open at {initialProbability}% and start in status OPEN.</p>

          <div className="flex flex-wrap gap-2">
            <button onClick={handleCreateMarket} disabled={creating || !newMarketQuestion.trim()} className={BTN_GREEN}>
              {creating ? 'Creating...' : 'Create Market'}
            </button>
            <button
              onClick={() => {
                setNewMarketQuestion('');
                setInitialProbability(50);
                setBValue(100);
              }}
              disabled={creating}
              className={BTN_NEUTRAL}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderMarketBetsTable(marketId) {
    if (!expandedMarketBets[marketId]) return null;

    if (loadingBetsByMarket[marketId]) {
      return (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 font-mono text-[0.72rem] text-[var(--text-muted)]">
          Loading bets...
        </div>
      );
    }

    const rows = marketBetsByMarket[marketId] || [];
    if (rows.length === 0) {
      return (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 font-mono text-[0.72rem] text-[var(--text-muted)]">
          No bets for this market.
        </div>
      );
    }

    return (
      <div className="mt-3 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface2)]">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Username</th>
              <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Side</th>
              <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Amount</th>
              <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Shares</th>
              <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Timestamp</th>
              <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Type</th>
              <th className="px-3 py-2 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((bet) => {
              const sideClass = bet.side === 'YES' ? 'text-[var(--green-bright)]' : 'text-[var(--red)]';
              const typeClass = bet.type === 'SELL' ? 'text-[var(--amber-bright)]' : 'text-[var(--text)]';
              return (
                <tr key={bet.id} className="border-b border-[var(--border)] last:border-b-0">
                  <td className="px-3 py-2 font-mono text-[0.72rem] text-[var(--text)]">{userNameCache[bet.userId] || bet.userName || 'Unknown'}</td>
                  <td className={`px-3 py-2 font-mono text-[0.72rem] ${sideClass}`}>{bet.side || '—'}</td>
                  <td className="px-3 py-2 font-mono text-[0.72rem] text-[var(--amber-bright)]">{formatMoney(bet.amount)}</td>
                  <td className="px-3 py-2 font-mono text-[0.72rem] text-[var(--text)]">{Number(bet.shares || 0).toFixed(2)}</td>
                  <td className="px-3 py-2 font-mono text-[0.72rem] text-[var(--text-dim)]">{formatDateTime(bet.timestamp)}</td>
                  <td className={`px-3 py-2 font-mono text-[0.72rem] ${typeClass}`}>{bet.type || 'BUY'}</td>
                  <td className="px-3 py-2">
                    {bet.type === 'BUY' ? (
                      <button
                        onClick={() => handleRefundSingleBet(bet)}
                        disabled={Boolean(bet.refunded) || refundingBetId === bet.id}
                        className={BTN_AMBER}
                      >
                        {bet.refunded ? 'Refunded' : refundingBetId === bet.id ? 'Refunding...' : 'Refund This Bet'}
                      </button>
                    ) : (
                      <span className="font-mono text-[0.68rem] text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderActiveMarketCard(market) {
    const status = getMarketStatus(market);
    const isLocked = status === MARKET_STATUS.LOCKED;
    const stats = marketStatsById[market.id] || { betCount: 0, totalVolume: 0 };
    const editingQuestion = editingQuestionMarketId === market.id;

    return (
      <div key={market.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex-1">
            {editingQuestion ? (
              <div className="space-y-2">
                <input
                  value={questionDrafts[market.id] || ''}
                  onChange={(e) => setQuestionDrafts((prev) => ({ ...prev, [market.id]: e.target.value }))}
                  className={INPUT_CLASS}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleEditQuestion(market.id, market.question)}
                    className={BTN_GREEN}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingQuestionMarketId(null);
                      setQuestionDrafts((prev) => ({ ...prev, [market.id]: market.question }));
                    }}
                    className={BTN_NEUTRAL}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <h3 className="text-base italic text-[var(--text)]" style={{ fontFamily: 'var(--display)' }}>{market.question}</h3>
            )}
          </div>
          <span style={getStatusBadgeStyle(status)} className="border px-2 py-1 font-mono text-[0.58rem] uppercase tracking-[0.06em]">
            {status}
          </span>
        </div>

        <p className="mb-1 font-mono text-[0.68rem] text-[var(--text-dim)]">
          {Math.round((market.probability || 0) * 100)}% · created {formatDate(market.createdAt)}
        </p>
        <p className="mb-1 font-mono text-[0.68rem] text-[var(--text-muted)]">
          {stats.betCount} bets · {formatMoney(stats.totalVolume)} traded
        </p>
        {market.resolutionDate && (
          <p className="mb-3 font-mono text-[0.68rem] text-[var(--text-muted)]">
            Resolution date: {formatDate(market.resolutionDate)}
          </p>
        )}

        <div className="mb-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <button
            onClick={() => handleResolve(market.id, 'YES')}
            disabled={resolving === market.id || cancelling === market.id || deletingMarketId === market.id}
            className={BTN_GREEN}
          >
            {resolving === market.id ? 'Resolving...' : 'Resolve YES'}
          </button>
          <button
            onClick={() => handleResolve(market.id, 'NO')}
            disabled={resolving === market.id || cancelling === market.id || deletingMarketId === market.id}
            className={BTN_RED}
          >
            {resolving === market.id ? 'Resolving...' : 'Resolve NO'}
          </button>
          <button
            onClick={() => handleToggleLock(market, isLocked ? MARKET_STATUS.OPEN : MARKET_STATUS.LOCKED)}
            disabled={locking === market.id || resolving === market.id || cancelling === market.id || deletingMarketId === market.id}
            className={BTN_AMBER}
          >
            {locking === market.id ? 'Saving...' : isLocked ? 'Unlock Market' : 'Lock Market'}
          </button>
          <button
            onClick={() => handleCancelAndRefund(market.id)}
            disabled={cancelling === market.id || resolving === market.id || deletingMarketId === market.id}
            className={BTN_NEUTRAL}
          >
            {cancelling === market.id ? 'Cancelling...' : 'Cancel + Refund'}
          </button>
        </div>

        <div className="mb-2">
          <input
            type="text"
            value={cancelReasonsByMarket[market.id] || ''}
            onChange={(e) =>
              setCancelReasonsByMarket((prev) => ({
                ...prev,
                [market.id]: e.target.value
              }))
            }
            placeholder="Optional cancellation reason"
            className={INPUT_CLASS}
          />
        </div>

        <div className="mb-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <button onClick={() => beginEditQuestion(market)} className={BTN_NEUTRAL}>Edit Question</button>
          <button
            onClick={() => handlePermanentDelete(market.id)}
            disabled={deletingMarketId === market.id || resolving === market.id || cancelling === market.id}
            className={BTN_RED}
          >
            {deletingMarketId === market.id ? 'Deleting...' : 'Permanent Delete'}
          </button>
          <button onClick={() => handleViewBets(market.id)} className={BTN_NEUTRAL}>
            {expandedMarketBets[market.id] ? 'Hide Bets' : 'View Bets'}
          </button>
          <Link href={`/market/${market.id}`} className={`${BTN_NEUTRAL} inline-flex items-center justify-center no-underline`}>
            View Market
          </Link>
        </div>

        {renderMarketBetsTable(market.id)}

        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-3">
          <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">Post market news</p>
          <div className="grid gap-2 md:grid-cols-3">
            <input
              type="text"
              placeholder="Headline"
              value={newsDrafts[market.id]?.headline || ''}
              onChange={(e) =>
                setNewsDrafts((prev) => ({
                  ...prev,
                  [market.id]: { ...(prev[market.id] || {}), headline: e.target.value }
                }))
              }
              className={INPUT_CLASS}
            />
            <input
              type="url"
              placeholder="URL"
              value={newsDrafts[market.id]?.url || ''}
              onChange={(e) =>
                setNewsDrafts((prev) => ({
                  ...prev,
                  [market.id]: { ...(prev[market.id] || {}), url: e.target.value }
                }))
              }
              className={INPUT_CLASS}
            />
            <input
              type="text"
              placeholder="Source"
              value={newsDrafts[market.id]?.source || ''}
              onChange={(e) =>
                setNewsDrafts((prev) => ({
                  ...prev,
                  [market.id]: { ...(prev[market.id] || {}), source: e.target.value }
                }))
              }
              className={INPUT_CLASS}
            />
          </div>
          <button onClick={() => handlePostNews(market)} className={`${BTN_AMBER} mt-2`}>
            Publish News Item
          </button>
        </div>
      </div>
    );
  }

  function renderResolvedMarketCard(market) {
    return (
      <div key={market.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm italic text-[var(--text)]" style={{ fontFamily: 'var(--display)' }}>{market.question}</p>
            <p className="mt-1 font-mono text-[0.68rem] text-[var(--text-muted)]">Resolved at: {formatDateTime(market.resolvedAt)}</p>
          </div>
          <span
            style={getStatusBadgeStyle(MARKET_STATUS.RESOLVED)}
            className="border px-2 py-1 font-mono text-[0.58rem] uppercase tracking-[0.06em]"
          >
            {market.resolution}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => handlePermanentDelete(market.id)}
            disabled={deletingMarketId === market.id}
            className={BTN_RED}
          >
            {deletingMarketId === market.id ? 'Deleting...' : 'Permanent Delete'}
          </button>
          <Link href={`/market/${market.id}`} className={`${BTN_NEUTRAL} inline-flex items-center justify-center no-underline`}>
            View Market
          </Link>
        </div>
      </div>
    );
  }

  function renderMarketsSection() {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {['Active', 'Resolved', 'Create New'].map((tab) => (
            <button
              key={tab}
              onClick={() => setMarketTab(tab)}
              className={`${ACTION_BUTTON_BASE} ${
                marketTab === tab
                  ? 'bg-[var(--red-glow)] text-[var(--red)] border-[rgba(220,38,38,0.3)]'
                  : 'bg-[var(--surface2)] text-[var(--text-dim)] border-[var(--border2)] hover:bg-[var(--surface3)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {marketTab === 'Active' && (
          <div className="space-y-3">
            {markets.length === 0 ? (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-mono text-[0.72rem] text-[var(--text-muted)]">
                No active markets.
              </p>
            ) : (
              markets.map(renderActiveMarketCard)
            )}
          </div>
        )}

        {marketTab === 'Resolved' && (
          <div className="space-y-3">
            {resolvedMarkets.length === 0 ? (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-mono text-[0.72rem] text-[var(--text-muted)]">
                No resolved markets.
              </p>
            ) : (
              resolvedMarkets.map(renderResolvedMarketCard)
            )}
          </div>
        )}

        {marketTab === 'Create New' && renderCreateMarketTab()}
      </div>
    );
  }

  function renderRequestsSection() {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <p className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Incoming Requests ({requests.length})
        </p>

        {requests.length === 0 ? (
          <p className="font-mono text-[0.72rem] text-[var(--text-muted)]">No pending requests.</p>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const edit = requestEdits[request.id] || request;
              const isEditing = editingRequestId === request.id;

              return (
                <div key={request.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-4">
                  {isEditing ? (
                    <div className="space-y-3">
                      <input
                        value={edit.question || ''}
                        onChange={(e) =>
                          setRequestEdits((prev) => ({
                            ...prev,
                            [request.id]: { ...edit, question: e.target.value }
                          }))
                        }
                        className={INPUT_CLASS}
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          type="number"
                          min="1"
                          max="99"
                          value={edit.initialProbability || 50}
                          onChange={(e) =>
                            setRequestEdits((prev) => ({
                              ...prev,
                              [request.id]: { ...edit, initialProbability: Number(e.target.value) }
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                        <input
                          type="number"
                          min="10"
                          max="1000"
                          step="10"
                          value={edit.liquidityB || 100}
                          onChange={(e) =>
                            setRequestEdits((prev) => ({
                              ...prev,
                              [request.id]: { ...edit, liquidityB: Number(e.target.value) }
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </div>
                      <textarea
                        value={edit.resolutionRules || ''}
                        onChange={(e) =>
                          setRequestEdits((prev) => ({
                            ...prev,
                            [request.id]: { ...edit, resolutionRules: e.target.value }
                          }))
                        }
                        rows={3}
                        className={INPUT_CLASS}
                      />
                      <input
                        type="date"
                        value={edit.resolutionDate || ''}
                        onChange={(e) =>
                          setRequestEdits((prev) => ({
                            ...prev,
                            [request.id]: { ...edit, resolutionDate: e.target.value }
                          }))
                        }
                        className={INPUT_CLASS}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <p className="text-sm text-[var(--text)]">{request.question}</p>
                        <span
                          className="border px-2 py-1 font-mono text-[0.58rem] uppercase tracking-[0.06em]"
                          style={{
                            borderRadius: '3px',
                            border: '1px solid rgba(217,119,6,0.25)',
                            background: 'rgba(217,119,6,0.14)',
                            color: 'var(--amber-bright)'
                          }}
                        >
                          Pending
                        </span>
                      </div>
                      <p className="font-mono text-[0.68rem] text-[var(--text-dim)]">Requested by: {request.submitterDisplayName || request.submittedBy}</p>
                      <p className="font-mono text-[0.68rem] text-[var(--text-dim)]">Initial probability: {request.initialProbability}%</p>
                      <p className="font-mono text-[0.68rem] text-[var(--text-dim)]">Liquidity b: {request.liquidityB}</p>
                      <p className="font-mono text-[0.68rem] text-[var(--text-dim)]">Resolution date: {formatDate(request.resolutionDate)}</p>
                      <p className="font-mono text-[0.68rem] text-[var(--text-dim)]">Rules: {request.resolutionRules}</p>
                    </>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {!isEditing ? (
                      <button onClick={() => startEditingRequest(request)} className={BTN_NEUTRAL}>Edit</button>
                    ) : (
                      <button
                        onClick={() => saveRequestEdits(request.id)}
                        disabled={processingRequestId === request.id}
                        className={BTN_GREEN}
                      >
                        {processingRequestId === request.id ? 'Saving...' : 'Save Edits'}
                      </button>
                    )}

                    <button
                      onClick={() => handleApproveRequest(request)}
                      disabled={processingRequestId === request.id}
                      className={BTN_GREEN}
                    >
                      {processingRequestId === request.id ? 'Working...' : 'Approve + Create'}
                    </button>

                    <button
                      onClick={() => setRejectingRequestId((prev) => (prev === request.id ? null : request.id))}
                      disabled={processingRequestId === request.id}
                      className={BTN_RED}
                    >
                      Reject
                    </button>
                  </div>

                  {rejectingRequestId === request.id && (
                    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                      <label className="mb-2 block font-mono text-[0.62rem] uppercase tracking-[0.05em] text-[var(--text-muted)]">
                        Rejection reason
                      </label>
                      <textarea
                        rows={2}
                        value={rejectReasons[request.id] || ''}
                        onChange={(e) =>
                          setRejectReasons((prev) => ({
                            ...prev,
                            [request.id]: e.target.value
                          }))
                        }
                        placeholder="Explain why this request was rejected"
                        className={INPUT_CLASS}
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => handleRejectRequest(request.id, rejectReasons[request.id] || '')}
                          disabled={processingRequestId === request.id}
                          className={BTN_RED}
                        >
                          {processingRequestId === request.id ? 'Rejecting...' : 'Confirm Rejection'}
                        </button>
                        <button
                          onClick={() => {
                            setRejectingRequestId(null);
                            setRejectReasons((prev) => ({ ...prev, [request.id]: '' }));
                          }}
                          disabled={processingRequestId === request.id}
                          className={BTN_NEUTRAL}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderUsersSection() {
    return (
      <div className="space-y-4">
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ borderLeft: '3px solid var(--amber-bright)',
            position: 'absolute', left: 0, top: 0, bottom: 0 }} />
          <div style={{ paddingLeft: '1rem' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.58rem',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              Weekly Reset
            </p>
            <p style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem',
              fontWeight: 700, color: 'var(--text)' }}>
              Resets all balances to $1,000.00
            </p>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '0.62rem',
              color: 'var(--text-dim)', marginTop: '0.15rem' }}>
              Next Monday at midnight · use at start of each week
            </p>
          </div>
          <button
            onClick={handleWeeklyReset}
            disabled={resetting}
            style={{
              fontFamily: 'var(--mono)', fontSize: '0.68rem',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              background: 'rgba(217,119,6,0.15)',
              color: 'var(--amber-bright)',
              border: '1px solid rgba(217,119,6,0.3)',
              borderRadius: '4px', padding: '0.5rem 1.25rem',
              cursor: resetting ? 'not-allowed' : 'pointer',
              opacity: resetting ? 0.6 : 1
            }}
          >
            {resetting ? 'Resetting...' : 'Run Weekly Reset →'}
          </button>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <label className="mb-2 block font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
            Search by email prefix
          </label>
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="e.g. ic367"
            className={INPUT_CLASS}
          />
        </div>

        <div className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Display Name</th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Email</th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Weekly Balance</th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Lifetime</th>
                <th className="px-4 py-3 text-left font-mono text-[0.62rem] uppercase text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((entry) => {
                const isEditing = editingUserId === entry.id;
                const isExpanded = expandedUsers[entry.id];
                const draft = userEdits[entry.id] || {
                  weeklyRep: Number(entry.weeklyRep || 0),
                  lifetimeRep: Number(entry.lifetimeRep || 0),
                  reason: ''
                };

                return (
                  <Fragment key={entry.id}>
                    <tr key={entry.id} className="border-b border-[var(--border)]">
                      <td className="px-4 py-3 font-mono text-[0.72rem] text-[var(--text)]">{getPublicDisplayName(entry)}</td>
                      <td className="px-4 py-3 font-mono text-[0.72rem] text-[var(--text-dim)]">{entry.email || '—'}</td>
                      <td className="px-4 py-3 font-mono text-[0.72rem] text-[var(--amber-bright)]">{formatMoney(entry.weeklyRep)}</td>
                      <td className="px-4 py-3 font-mono text-[0.72rem] text-[var(--green-bright)]">{formatMoney(entry.lifetimeRep)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => (isEditing ? setEditingUserId(null) : startEditingUser(entry))} className={BTN_NEUTRAL}>
                            {isEditing ? 'Close' : 'Edit'}
                          </button>
                          <button
                            onClick={async () => {
                              const nextExpanded = !expandedUsers[entry.id];
                              setExpandedUsers((prev) => ({ ...prev, [entry.id]: nextExpanded }));
                              if (nextExpanded) {
                                await loadUserBetCount(entry.id);
                              }
                            }}
                            className={BTN_NEUTRAL}
                          >
                            {isExpanded ? 'Hide Bets' : 'View Bets'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {(isEditing || isExpanded) && (
                      <tr className="border-b border-[var(--border)] bg-[var(--surface2)]">
                        <td className="px-4 py-3" colSpan={5}>
                          {isExpanded && (
                            <p className="mb-2 font-mono text-[0.68rem] text-[var(--text-dim)]">
                              Total bets: {loadingUserBetCounts[entry.id] ? 'Loading...' : userBetCounts[entry.id] ?? 0}
                            </p>
                          )}

                          {isEditing && (
                            <div className="grid gap-2 md:grid-cols-3">
                              <input
                                type="number"
                                value={draft.weeklyRep}
                                onChange={(e) =>
                                  setUserEdits((prev) => ({
                                    ...prev,
                                    [entry.id]: {
                                      ...draft,
                                      weeklyRep: Number(e.target.value)
                                    }
                                  }))
                                }
                                placeholder="Weekly balance"
                                className={INPUT_CLASS}
                              />
                              <input
                                type="number"
                                value={draft.lifetimeRep}
                                onChange={(e) =>
                                  setUserEdits((prev) => ({
                                    ...prev,
                                    [entry.id]: {
                                      ...draft,
                                      lifetimeRep: Number(e.target.value)
                                    }
                                  }))
                                }
                                placeholder="Lifetime rep"
                                className={INPUT_CLASS}
                              />
                              <input
                                type="text"
                                value={draft.reason}
                                onChange={(e) =>
                                  setUserEdits((prev) => ({
                                    ...prev,
                                    [entry.id]: {
                                      ...draft,
                                      reason: e.target.value
                                    }
                                  }))
                                }
                                placeholder="Reason (required)"
                                className={INPUT_CLASS}
                              />
                              <div className="md:col-span-3 flex flex-wrap gap-2">
                                <button
                                  onClick={() => handleSaveUserEdit(entry)}
                                  disabled={savingUserId === entry.id}
                                  className={BTN_GREEN}
                                >
                                  {savingUserId === entry.id ? 'Saving...' : 'Save'}
                                </button>
                                <button onClick={() => setEditingUserId(null)} disabled={savingUserId === entry.id} className={BTN_NEUTRAL}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderModerationSection() {
    const showingComments = moderationTab === 'Comments';

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {['Comments', 'News Items'].map((tab) => (
            <button
              key={tab}
              onClick={() => setModerationTab(tab)}
              className={`${ACTION_BUTTON_BASE} ${
                moderationTab === tab
                  ? 'bg-[var(--red-glow)] text-[var(--red)] border-[rgba(220,38,38,0.3)]'
                  : 'bg-[var(--surface2)] text-[var(--text-dim)] border-[var(--border2)] hover:bg-[var(--surface3)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {loadingModeration ? (
            <p className="px-4 py-3 font-mono text-[0.72rem] text-[var(--text-muted)]">Loading moderation data...</p>
          ) : showingComments ? (
            <div className="divide-y divide-[var(--border)]">
              {commentsModeration.length === 0 ? (
                <p className="px-4 py-3 font-mono text-[0.72rem] text-[var(--text-muted)]">No comments found.</p>
              ) : (
                commentsModeration.map((comment) => (
                  <div key={comment.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.4fr_1fr_2fr_160px_auto] md:items-center">
                    <span className="font-mono text-[0.68rem] text-[var(--text-dim)]">{marketQuestionMap[comment.marketId] || 'Loading market...'}</span>
                    <span className="font-mono text-[0.68rem] text-[var(--text)]">{comment.username || comment.userName || 'Unknown'}</span>
                    <span className="text-sm text-[var(--text)]">{comment.text}</span>
                    <span className="font-mono text-[0.62rem] text-[var(--text-muted)]">{formatDateTime(comment.timestamp || comment.createdAt)}</span>
                    <button
                      onClick={() => handleDeleteComment(comment)}
                      disabled={deletingCommentId === comment.id}
                      className={BTN_RED}
                    >
                      {deletingCommentId === comment.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {newsModeration.length === 0 ? (
                <p className="px-4 py-3 font-mono text-[0.72rem] text-[var(--text-muted)]">No news items found.</p>
              ) : (
                newsModeration.map((item) => (
                  <div key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1.2fr_120px_1.5fr_1fr_160px_auto] md:items-center">
                    <span className="font-mono text-[0.68rem] text-[var(--text-dim)]">{marketQuestionMap[item.marketId] || 'Loading market...'}</span>
                    <span className="font-mono text-[0.68rem] text-[var(--amber-bright)]">{item.source || '—'}</span>
                    <span className="text-sm text-[var(--text)]">{item.headline}</span>
                    <a href={item.url} target="_blank" rel="noreferrer" className="font-mono text-[0.68rem] text-[var(--red)] underline">
                      {item.url}
                    </a>
                    <span className="font-mono text-[0.62rem] text-[var(--text-muted)]">{formatDateTime(item.timestamp)}</span>
                    <button
                      onClick={() => handleDeleteNewsItem(item)}
                      disabled={deletingNewsId === item.id}
                      className={BTN_RED}
                    >
                      {deletingNewsId === item.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderSectionContent() {
    if (activeSection === 'Overview') return renderOverviewSection();
    if (activeSection === 'Markets') return renderMarketsSection();
    if (activeSection === 'Requests') return renderRequestsSection();
    if (activeSection === 'Users') return renderUsersSection();
    return renderModerationSection();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-8 py-10 text-center font-mono text-[var(--text-muted)]">
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-8 py-10 text-center font-mono text-[var(--text-muted)]">
        Access denied
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <aside className="fixed left-0 top-14 h-[calc(100vh-56px)] w-[220px] border-r border-[var(--border)] bg-[var(--bg)] px-4 py-6">
        <p className="mb-2 flex items-center gap-2 font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          <span className="inline-block h-px w-3 bg-[var(--red)]" />
          Admin
        </p>
        <p className="mb-6 text-xl italic text-[var(--text)]" style={{ fontFamily: 'var(--display)' }}>
          Predict <span className="text-[var(--red)]">Cornell</span>
        </p>

        <nav className="space-y-1">{SECTIONS.map(renderSectionNavButton)}</nav>

        <p className="absolute bottom-5 left-4 right-4 font-mono text-[0.58rem] text-[var(--text-muted)] break-all">
          {user.email}
        </p>
      </aside>

      <main className="ml-[220px] px-8 py-8">
        <h1 className="mb-1 text-2xl text-[var(--text)]" style={{ fontFamily: 'var(--display)' }}>
          Admin Dashboard
        </h1>
        <p className="mb-6 font-mono text-[0.68rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
          {activeSection}
        </p>

        {renderSectionContent()}
      </main>

      <ToastStack toasts={toasts} onDismiss={removeToast} onConfirm={resolveConfirm} />
    </div>
  );
}
