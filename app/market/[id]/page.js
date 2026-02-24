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
  limit,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '@/lib/firebase';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { calculateBet, calculateSell } from '@/utils/lmsr';
import { MARKET_STATUS, isTradeableMarket } from '@/utils/marketStatus';
import InfoTooltip from '@/app/components/InfoTooltip';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';
import { getPublicDisplayName } from '@/utils/displayName';
import { ADMIN_EMAILS } from '@/utils/adminEmails';
import { ANALYTICS_EVENTS, trackEvent } from '@/utils/analytics';
import { useMarketData } from '@/app/hooks/useMarketData';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Tooltip,
  CartesianGrid,
  XAxis,
  YAxis,
  ReferenceLine,
  ReferenceDot
} from 'recharts';

function getInitials(name) {
  if (!name) return 'PC';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PC';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function safeDate(value) {
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getCallableErrorMessage(error, fallbackMessage) {
  const details = typeof error?.details === 'string' ? error.details.trim() : '';
  if (details) return details;
  const rawMessage = typeof error?.message === 'string' ? error.message.trim() : '';
  if (!rawMessage) return fallbackMessage;
  return rawMessage
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^functions\/[a-z-]+:\s*/i, '')
    .trim() || fallbackMessage;
}

export default function MarketPage() {
  const params = useParams();
  const router = useRouter();
  const { toasts, notifyError, notifySuccess, confirmToast, removeToast, resolveConfirm } = useToastQueue();

  const [currentUser, setCurrentUser] = useState(null);
  const [currentDisplayName, setCurrentDisplayName] = useState('user');
  const [isMobile, setIsMobile] = useState(false);
  const [viewTrackedForMarket, setViewTrackedForMarket] = useState(null);

  // Trade State
  const [betAmount, setBetAmount] = useState('');
  const [selectedSide, setSelectedSide] = useState('YES');
  const [preview, setPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Sell State
  const [showSellModal, setShowSellModal] = useState(false);
  const [sellSide, setSellSide] = useState('YES');
  const [sellAmount, setSellAmount] = useState('');
  const [sellPreview, setSellPreview] = useState(null);
  const [selling, setSelling] = useState(false);

  // Comment State
  const [newComment, setNewComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingText, setEditingText] = useState('');

  // 1. Unified Data Hook
  const {
    market,
    membership,
    betHistory,
    userPosition,
    recentTrades,
    comments,
    newsItems,
    topBettors,
    relatedMarkets,
    marketStats,
    loading: dataLoading,
    error: dataError,
    refresh
  } = useMarketData(params.id, currentUser);

  // 2. Auth Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setCurrentUser(user);
      if (!user) {
        setCurrentDisplayName('user');
        return;
      }
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          setCurrentDisplayName(getPublicDisplayName({ id: user.uid, ...userDoc.data() }));
        } else {
          setCurrentDisplayName(user.email?.split('@')[0] || 'user');
        }
      } catch (error) {
        console.error('Error fetching display name:', error);
        setCurrentDisplayName(user.email?.split('@')[0] || 'user');
      }
    });
    return () => unsubscribe();
  }, []);

  // 3. UI Helpers
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (dataError === 'AUTH_REQUIRED') {
      router.push(`/marketplace/enter?marketplace=${market?.marketplaceId}`);
    } else if (dataError === 'MEMBERSHIP_REQUIRED') {
      notifyError('This market belongs to a private marketplace. Join to view and trade.');
      router.push(`/marketplace/enter?marketplace=${market?.marketplaceId}`);
    }
  }, [dataError, market?.marketplaceId, notifyError, router]);

  useEffect(() => {
    if (!market?.id) return;
    if (viewTrackedForMarket === market.id) return;
    trackEvent(ANALYTICS_EVENTS.MARKET_VIEWED, {
      marketId: market.id,
      marketplaceId: market.marketplaceId || null,
      category: market.category || null
    });
    setViewTrackedForMarket(market.id);
  }, [market, viewTrackedForMarket]);

  // Derived Values
  const marketStatus = market ? (market.status || (market.resolution ? MARKET_STATUS.RESOLVED : MARKET_STATUS.OPEN)) : MARKET_STATUS.OPEN;
  const isLocked = marketStatus === MARKET_STATUS.LOCKED;
  const isResolved = marketStatus === MARKET_STATUS.RESOLVED;
  const isCancelled = marketStatus === MARKET_STATUS.CANCELLED;
  const canTrade = currentUser && isTradeableMarket(market) && (!market?.marketplaceId || !!membership);
  const userSide = userPosition.yesShares > 0 ? 'YES' : userPosition.noShares > 0 ? 'NO' : null;
  const isAdminUser = !!(currentUser?.email && ADMIN_EMAILS.includes(currentUser.email));

  const exitValues = useMemo(() => {
    if (!market?.outstandingShares) return { yesExit: 0, noExit: 0 };
    try {
      const yesExit = userPosition.yesShares > 0
        ? calculateSell(market.outstandingShares, userPosition.yesShares, 'YES', market.b).payout
        : 0;
      const noExit = userPosition.noShares > 0
        ? calculateSell(market.outstandingShares, userPosition.noShares, 'NO', market.b).payout
        : 0;
      return { yesExit, noExit };
    } catch (e) {
      return { yesExit: 0, noExit: 0 };
    }
  }, [market, userPosition]);

  const repliesByParent = useMemo(() => {
    return comments.reduce((acc, comment) => {
      if (!comment.replyTo) return acc;
      if (!acc[comment.replyTo]) acc[comment.replyTo] = [];
      acc[comment.replyTo].push(comment);
      return acc;
    }, {});
  }, [comments]);

  const timelineItems = useMemo(() => {
    const commentItems = comments.filter((comment) => !comment.replyTo).map((comment) => ({
      id: `comment-${comment.id}`,
      type: 'COMMENT',
      timestamp: safeDate(comment.timestamp || comment.createdAt),
      data: comment
    }));

    const news = newsItems.map((newsItem) => ({
      id: `news-${newsItem.id}`,
      type: 'NEWS',
      timestamp: safeDate(newsItem.timestamp),
      data: newsItem
    }));

    const events = [];
    for (let i = 1; i < betHistory.length; i += 1) {
      const prev = betHistory[i - 1];
      const next = betHistory[i];
      const delta = (next.probability || 0) - (prev.probability || 0);
      if (Math.abs(delta) >= 0.05) {
        events.push({
          id: `event-${i}`,
          type: 'EVENT',
          timestamp: new Date(next.timestamp),
          data: {
            before: prev.probability,
            after: next.probability,
            delta
          }
        });
      }
    }

    return [...commentItems, ...news, ...events].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [comments, newsItems, betHistory]);

  // Preview Logic
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

  // Handlers
  async function handlePlaceBet() {
    if (!currentUser) {
      if (await confirmToast('You need to sign in to place bets. Go to login page?')) {
        window.location.href = '/login';
      }
      return;
    }
    if (!isTradeableMarket(market)) {
      notifyError('Trading is currently locked for this market.');
      return;
    }
    if (!betAmount || parseFloat(betAmount) <= 0) {
      notifyError('Please enter a valid amount');
      return;
    }

    setSubmitting(true);
    let optimisticApplied = false;
    try {
      const amount = parseFloat(betAmount);
      const result = calculateBet(market.outstandingShares, amount, selectedSide, market.b);
      
      applyOptimisticTrade({
        side: selectedSide,
        amount,
        shares: result.shares,
        newProbability: result.newProbability,
        newPool: result.newPool,
        type: 'BUY'
      });
      optimisticApplied = true;

      const placeBetCallable = httpsCallable(functions, 'placeBet');
      await placeBetCallable({
        marketId: params.id,
        side: selectedSide,
        amount,
        marketplaceId: market?.marketplaceId || null
      });

      refresh(); // Reload all data
      setBetAmount('');
      setPreview(null);
      notifySuccess('Bet placed!');
    } catch (error) {
      if (optimisticApplied) rollbackOptimisticTrade();
      console.error('Error placing bet:', error);
      notifyError(getCallableErrorMessage(error, 'Error placing bet. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSell() {
    const sharesToSell = parseFloat(sellAmount);
    const availableShares = sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares;

    if (!sellAmount || sharesToSell <= 0) {
      notifyError('Please enter a valid amount');
      return;
    }
    if (sharesToSell > availableShares) {
      notifyError(`Insufficient shares. You have ${availableShares.toFixed(2)} ${sellSide} shares.`);
      return;
    }

    setSelling(true);
    let optimisticApplied = false;
    try {
      const result = calculateSell(market.outstandingShares, sharesToSell, sellSide, market.b);
      
      applyOptimisticTrade({
        side: sellSide,
        amount: -result.payout, // Negative amount for stats/invested adjustment
        shares: sharesToSell,
        newProbability: result.newProbability,
        newPool: result.newPool,
        type: 'SELL'
      });
      optimisticApplied = true;

      const sellSharesCallable = httpsCallable(functions, 'sellShares');
      await sellSharesCallable({
        marketId: params.id,
        side: sellSide,
        sharesToSell,
        marketplaceId: market?.marketplaceId || null
      });

      refresh();
      setSellAmount('');
      setSellPreview(null);
      setShowSellModal(false);
      notifySuccess('Shares sold!');
    } catch (error) {
      if (optimisticApplied) rollbackOptimisticTrade();
      console.error('Error selling shares:', error);
      notifyError(getCallableErrorMessage(error, 'Error selling shares. Please try again.'));
    } finally {
      setSelling(false);
    }
  }

  async function handlePostComment() {
    if (!currentUser || !newComment.trim()) return;
    setPostingComment(true);
    try {
      await addDoc(collection(db, 'comments'), {
        marketId: params.id,
        marketplaceId: market?.marketplaceId || null,
        userId: currentUser.uid,
        username: currentDisplayName,
        userName: currentDisplayName,
        text: newComment.trim(),
        createdAt: new Date(),
        timestamp: new Date(),
        likedBy: [],
        replyTo: null,
        userSide
      });
      setNewComment('');
      notifySuccess('Comment posted.');
      refresh();
    } catch (error) {
      console.error('Error posting comment:', error);
      notifyError('Unable to post comment.');
    } finally {
      setPostingComment(false);
    }
  }

  async function handlePostReply(parentId) {
    if (!currentUser || !replyText.trim()) return;
    setPostingComment(true);
    try {
      await addDoc(collection(db, 'comments'), {
        marketId: params.id,
        marketplaceId: market?.marketplaceId || null,
        userId: currentUser.uid,
        username: currentDisplayName,
        userName: currentDisplayName,
        text: replyText.trim(),
        createdAt: new Date(),
        timestamp: new Date(),
        likedBy: [],
        replyTo: parentId,
        userSide
      });
      setReplyText('');
      setReplyingTo(null);
      notifySuccess('Reply posted.');
      refresh();
    } catch (error) {
      console.error('Error posting reply:', error);
      notifyError('Unable to post reply.');
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
      setEditingCommentId(null);
      setEditingText('');
      notifySuccess('Comment updated.');
      refresh();
    } catch (error) {
      notifyError('Unable to update comment.');
    }
  }

  async function handleDeleteComment(comment) {
    if (!isAdminUser && currentUser?.uid !== comment.userId) return;
    try {
      await deleteDoc(doc(db, 'comments', comment.id));
      notifySuccess('Comment deleted.');
      refresh();
    } catch (error) {
      notifyError('Unable to delete comment.');
    }
  }

  async function handleShareMarket() {
    if (typeof window === 'undefined') return;
    const shareUrl = window.location.href;
    const shareTitle = market?.question || 'Predict Cornell market';
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: 'Check out this market on Predict Cornell', url: shareUrl });
        notifySuccess('Shared.');
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        notifySuccess('Market link copied.');
        return;
      }
    } catch (error) {
      if (error?.name !== 'AbortError') notifyError('Unable to share.');
    }
  }

  if (dataLoading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading market data...</div>;
  if (dataError && dataError !== 'AUTH_REQUIRED' && dataError !== 'MEMBERSHIP_REQUIRED') return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">{dataError}</div>;
  if (!market) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Market not found</div>;

  // Formatting helpers
  const currentProbability = market.probability || 0.5;
  const probabilityColor = currentProbability > 0.65 ? 'text-[var(--green-bright)]' : currentProbability < 0.35 ? 'text-[var(--red)]' : 'text-[var(--amber-bright)]';
  const daysRemaining = market.resolutionDate?.toDate
    ? Math.max(0, Math.ceil((market.resolutionDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const firstProb = betHistory[0]?.probability ?? 0.5;
  const delta = currentProbability - firstProb;
  const deltaClass = delta >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]';
  const deltaText = `${delta >= 0 ? '↑' : '↓'} ${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}% from start`;
  
  const categoryLabel = market.category || 'Campus';
  const truncatedQuestion = market.question.length > 36 ? `${market.question.slice(0, 36)}...` : market.question;
  const statusTagLabel = isResolved ? 'Resolved' : isCancelled ? 'Cancelled' : isLocked ? 'Locked' : '● Live';
  const statusTagClass = isResolved ? 'border-[rgba(22,163,74,.28)] bg-[rgba(22,163,74,.08)] text-[var(--green-bright)]' : isCancelled ? 'border-[var(--border2)] bg-[var(--surface2)] text-[var(--text-dim)]' : isLocked ? 'border-[rgba(217,119,6,.28)] bg-[rgba(217,119,6,.08)] text-[var(--amber-bright)]' : 'border-[rgba(22,163,74,.28)] bg-[rgba(22,163,74,.08)] text-[var(--green-bright)]';

  const chartNewsMarkers = newsItems.map(ni => ({
    id: ni.id,
    timestamp: safeDate(ni.timestamp).getTime(),
    probability: ni.probabilityAtPost ?? currentProbability
  })).filter(m => Number.isFinite(m.timestamp)).slice(0, 4);

  const renderCommentCard = (comment, isReply = false) => {
    const isOwner = currentUser?.uid === comment.userId;
    const canDelete = isOwner || isAdminUser;
    const displayName = comment.username || comment.userName || 'trader';
    const sideClass = comment.userSide === 'YES' ? 'bg-[rgba(22,163,74,.1)] text-[var(--green-bright)] border border-[rgba(22,163,74,.2)]' : 'bg-[var(--red-glow)] text-[var(--red)] border border-[rgba(220,38,38,.2)]';

    return (
      <div className={`${isReply ? 'mt-3 border-l border-[var(--border)] pl-4' : ''}`}>
        <div className={`rounded-md border border-[var(--border)] ${isReply ? 'bg-[var(--surface2)]' : 'bg-[var(--surface)]'} p-4 transition-colors hover:bg-[var(--surface2)]`}>
          <div className="mb-2 flex items-center gap-2">
            <div className="h-6 w-6 rounded-full border border-[var(--border2)] bg-[var(--surface3)] font-mono text-[0.52rem] font-bold text-[var(--text-dim)] flex items-center justify-center">
              {getInitials(displayName)}
            </div>
            <span className="text-sm font-semibold text-[var(--text)]">{displayName}</span>
            {comment.userSide && <span className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[0.58rem] font-bold uppercase ${sideClass}`}>{comment.userSide}</span>}
            <span className="font-mono text-[0.58rem] text-[var(--text-muted)]">{safeDate(comment.timestamp || comment.createdAt).toLocaleString()}</span>
          </div>

          {editingCommentId === comment.id ? (
            <div className="space-y-2">
              <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} className="w-full rounded border border-[var(--border2)] bg-[var(--surface2)] p-2 text-sm text-[var(--text)]" rows={2} maxLength={400} />
              <div className="flex gap-2">
                <button onClick={() => handleSaveComment(comment.id)} className="rounded bg-[var(--red)] px-2 py-1 text-xs font-semibold text-white">Save</button>
                <button onClick={() => { setEditingCommentId(null); setEditingText(''); }} className="rounded bg-[var(--surface3)] px-2 py-1 text-xs font-semibold text-[var(--text-dim)]">Cancel</button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--text-dim)] whitespace-pre-wrap">{comment.text}</p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <span className="font-mono text-[0.58rem] text-[var(--text-muted)]">♥ {Array.isArray(comment.likedBy) ? comment.likedBy.length : Number(comment.likes || 0)}</span>
            <button onClick={() => { if (!currentUser) return notifyError('Sign in to reply.'); setReplyingTo(comment.id); setReplyText(''); }} className="font-mono text-[0.58rem] text-[var(--text-muted)] hover:text-[var(--text-dim)]">↩ reply</button>
            {isOwner && editingCommentId !== comment.id && <button onClick={() => { setEditingCommentId(comment.id); setEditingText(comment.text); }} className="font-mono text-[0.58rem] text-[var(--text-muted)]">Edit</button>}
            {canDelete && editingCommentId !== comment.id && <button onClick={() => handleDeleteComment(comment)} className="font-mono text-[0.58rem] text-[var(--red)]">Delete</button>}
          </div>
        </div>
        {replyingTo === comment.id && (
          <div className="mt-[0.6rem] ml-4 border-l border-[var(--border)] pl-4">
            <textarea placeholder="Write a reply..." value={replyText} onChange={(e) => setReplyText(e.target.value)} className="min-h-[52px] w-full resize-none rounded-[5px] border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 text-[0.82rem] text-[var(--text)]" />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => { setReplyingTo(null); setReplyText(''); }} className="font-mono text-[0.6rem] uppercase text-[var(--text-muted)]">Cancel</button>
              <button onClick={() => handlePostReply(comment.id)} className="rounded bg-[var(--red)] px-4 py-1.5 font-mono text-[0.62rem] uppercase text-white">Reply →</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="mx-auto max-w-[1200px] md:grid md:grid-cols-[1fr_320px]" style={{ minHeight: 'calc(100vh - 56px)' }}>
        <main className="p-4 md:border-r md:border-[var(--border)] md:p-8">
          <div className="mb-6 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[0.62rem] leading-none text-[var(--text-muted)]">
            <Link href="/markets" className="uppercase tracking-[0.08em] text-[var(--text-dim)] hover:text-[var(--text)]">Markets</Link>
            <span>/</span>
            <span className="uppercase tracking-[0.08em] text-[var(--text-dim)]">{categoryLabel}</span>
            <span>/</span>
            <span className="tracking-normal text-[var(--text)] normal-case">{truncatedQuestion}</span>
          </div>

          {market.marketplaceId && (
            <div className="mb-5 rounded border border-[var(--red-dim)] bg-[var(--red-glow)] px-4 py-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--red)]">Marketplace Wallet</p>
                  <p className="mt-1 font-mono text-[0.66rem] text-[var(--text-dim)]">This market uses your private marketplace balance.</p>
                </div>
                <p className="font-mono text-[1.35rem] font-bold tracking-[-0.03em] text-[var(--amber-bright)]">
                  {membership ? `$${Number(membership.balance || 0).toFixed(2)}` : 'Loading...'}
                </p>
              </div>
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded border border-[var(--red-dim)] bg-[var(--red-glow)] px-2 py-1 font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--red)]">{categoryLabel}</span>
            <span className={`rounded border px-2 py-1 font-mono text-[0.55rem] uppercase tracking-[0.08em] ${statusTagClass}`}>{statusTagLabel}</span>
          </div>

          <h1 className="mb-7 max-w-[640px] font-display text-[2rem] leading-tight tracking-[-0.015em] text-[var(--text)]">{market.question}</h1>

          <div className="mb-6 flex flex-col gap-4 border-b border-[var(--border)] pb-6 md:flex-row md:flex-wrap md:items-end md:gap-8">
            <div>
              <span className={`block font-mono text-[3rem] font-bold leading-none tracking-[-0.06em] md:text-[4.5rem] ${probabilityColor}`}>
                {Math.round(currentProbability * 100)}%
              </span>
              <span className={`mt-1 block font-mono text-[0.68rem] ${deltaClass}`}>{deltaText}</span>
              <span className="mt-1 block font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">chance YES</span>
            </div>
            <div className="grid grid-cols-3 gap-4 md:ml-auto md:gap-6 md:pb-2">
              <div>
                <span className="block font-mono text-lg font-bold text-[var(--text)]">${marketStats.totalTraded.toFixed(0)}</span>
                <span className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">traded</span>
              </div>
              <div>
                <span className="block font-mono text-lg font-bold text-[var(--text)]">{marketStats.bettors}</span>
                <span className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">bettors</span>
              </div>
              <div>
                <span className={`block font-mono text-lg font-bold ${daysRemaining !== null && daysRemaining <= 2 ? 'text-[var(--red)]' : 'text-[var(--text)]'}`}>
                  {daysRemaining === null ? 'N/A' : `${daysRemaining}d`}
                </span>
                <span className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">remaining</span>
              </div>
            </div>
          </div>

          {isLocked && <div className="mb-6 rounded-lg border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] p-3 text-sm text-[#f59e0b]">Trading is locked by admin.</div>}
          {isCancelled && <div className="mb-4 rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--amber-bright)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]">This market was cancelled.</div>}

          <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-2 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]"><span className="inline-block h-px w-3 bg-[var(--red)]" />How this resolves</p>
            <p className="text-sm leading-6 text-[var(--text)]">{market.resolutionRules || 'No rules posted.'}</p>
          </div>

          <div className="mb-7">
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
              <ComposedChart data={betHistory} margin={{ top: 6, right: 6, left: -14, bottom: 8 }}>
                <defs>
                  <linearGradient id="probGradientFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#DC2626" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#DC2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis dataKey="timestamp" stroke="#333" tick={{ fill: '#3D3B38', fontSize: 9, fontFamily: 'Space Mono' }} tickFormatter={(ts) => new Date(ts).toLocaleDateString()} />
                <YAxis domain={[0, 1]} stroke="#333" tick={{ fill: '#3D3B38', fontSize: 9, fontFamily: 'Space Mono' }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                {chartNewsMarkers.map(m => <ReferenceLine key={m.id} x={m.timestamp} stroke="var(--amber)" strokeDasharray="3 3" />)}
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-lg">
                      <p className="font-mono text-[0.62rem] text-[var(--text-muted)]">{new Date(label).toLocaleString()}</p>
                      <p className="font-mono text-sm font-bold text-[var(--text)]">{Math.round(payload[0].value * 100)}%</p>
                    </div>
                  );
                }} />
                <Area type="monotone" dataKey="probability" fill="url(#probGradientFill)" stroke="none" />
                <Line type="monotone" dataKey="probability" stroke="var(--red)" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {currentUser && !isResolved && !isCancelled && (userPosition.yesShares > 0 || userPosition.noShares > 0) && (
            <div className="mb-6 border-b border-[var(--border)] bg-[var(--surface)] pb-4">
              <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Your Position</p>
              <div className="space-y-3">
                {userPosition.yesShares > 0 && <PositionCard side="YES" shares={userPosition.yesShares} invested={userPosition.yesInvested} exitValue={exitValues.yesExit} onSell={() => { setSellSide('YES'); setShowSellModal(true); }} canSell={canTrade} />}
                {userPosition.noShares > 0 && <PositionCard side="NO" shares={userPosition.noShares} invested={userPosition.noInvested} exitValue={exitValues.noExit} onSell={() => { setSellSide('NO'); setShowSellModal(true); }} canSell={canTrade} />}
              </div>
            </div>
          )}

          <div className="sticky bottom-0 z-20 mb-8 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-4 md:static">
            {isResolved ? (
              <div className="py-3 text-center">
                <p className="font-mono text-4xl font-bold text-[var(--text)]">{market.resolution}</p>
                <p className="mt-1 text-sm text-[var(--text-dim)]">Market Resolved</p>
              </div>
            ) : (
              <>
                <p className="mb-4 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">Place a bet</p>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <button onClick={() => setSelectedSide('YES')} className={`min-h-[52px] rounded border px-4 py-3 ${selectedSide === 'YES' ? 'border-[var(--green-bright)] bg-[rgba(22,163,74,.08)]' : 'bg-[var(--surface2)]'}`}>
                    <span className="block font-mono text-[0.58rem] uppercase text-[var(--text-muted)]">YES</span>
                    <span className="block font-mono text-[1.35rem] font-bold text-[var(--green-bright)]">{Math.round(currentProbability * 100)}%</span>
                  </button>
                  <button onClick={() => setSelectedSide('NO')} className={`min-h-[52px] rounded border px-4 py-3 ${selectedSide === 'NO' ? 'border-[var(--red)] bg-[var(--red-glow)]' : 'bg-[var(--surface2)]'}`}>
                    <span className="block font-mono text-[0.58rem] uppercase text-[var(--text-muted)]">NO</span>
                    <span className="block font-mono text-[1.35rem] font-bold text-[var(--red)]">{Math.round((1 - currentProbability) * 100)}%</span>
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    placeholder="$0.00"
                    className="flex-1 rounded border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2"
                  />
                  <button onClick={handlePlaceBet} disabled={submitting || !betAmount} className="bg-[var(--red)] px-5 py-2 font-mono text-white rounded">
                    {submitting ? '...' : `Bet ${selectedSide}`}
                  </button>
                </div>
                {preview && <div className="mt-2 text-[0.65rem] font-mono text-[var(--text-muted)]">Est. {preview.shares.toFixed(1)} shares · New Prob: {Math.round(preview.newProbability * 100)}%</div>}
              </>
            )}
          </div>

          <div className="mb-5 flex border-b border-[var(--border)]"><span className="mb-[-1px] border-b-2 border-[var(--red)] px-4 py-2 font-mono text-[0.65rem] uppercase text-[var(--text)]">Timeline</span></div>
          <div className="space-y-4">
            {timelineItems.map(item => {
              if (item.type === 'NEWS') {
                const ni = item.data;
                const newsReplies = (repliesByParent[ni.id] || []).sort((a, b) => safeDate(a.timestamp || a.createdAt) - safeDate(b.timestamp || b.createdAt));
                return (
                  <div key={item.id} className="relative pl-8">
                    <span className="absolute left-0 top-1">⚡</span>
                    <div className="rounded border border-[var(--border)] border-l-[3px] border-l-[var(--amber-bright)] bg-[var(--surface)] p-4">
                      <p className="mb-1 font-mono text-[0.58rem] text-[var(--amber-bright)] uppercase">News · {ni.source}</p>
                      <a href={ni.url} target="_blank" rel="noreferrer" className="font-semibold text-sm hover:underline">{ni.headline}</a>
                      <div className="mt-3">{newsReplies.map(r => renderCommentCard(r, true))}</div>
                    </div>
                  </div>
                );
              }
              if (item.type === 'COMMENT') return <div key={item.id}>{renderCommentCard(item.data)}</div>;
              return null;
            })}
          </div>

          <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
            {currentUser ? (
              <>
                <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Your take..." className="w-full min-h-[80px] bg-[var(--surface2)] border border-[var(--border2)] rounded p-3 text-sm" />
                <div className="mt-3 flex justify-between items-center">
                  <span className="text-[0.58rem] text-[var(--text-muted)] font-mono">Posting as {currentDisplayName}</span>
                  <button onClick={handlePostComment} disabled={postingComment || !newComment.trim()} className="bg-[var(--red)] text-white px-4 py-2 rounded text-xs uppercase font-mono">{postingComment ? '...' : 'Post →'}</button>
                </div>
              </>
            ) : <p className="text-xs text-[var(--text-dim)]">Sign in to comment.</p>}
          </div>
        </main>

        <aside className="p-4 md:p-8 space-y-8">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleShareMarket} className="rounded border border-[var(--border)] bg-[var(--surface)] py-2 font-mono text-[0.62rem] uppercase">↗ Share</button>
            <button className="rounded border border-[var(--border)] bg-[var(--surface)] py-2 font-mono text-[0.62rem] uppercase">⊕ Follow</button>
          </div>
          <section>
            <p className="mb-3 font-mono text-[0.6rem] uppercase text-[var(--text-muted)]">Whale Watch</p>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
              {topBettors.map((b, i) => (
                <div key={b.userId} className="p-3 flex items-center justify-between text-xs">
                  <span className="text-[var(--text-dim)]">{i + 1}. {b.name}</span>
                  <span className="font-mono font-bold text-[var(--amber-bright)]">${b.invested.toFixed(0)}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {showSellModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[var(--surface)] rounded-xl p-6 max-w-md w-full border border-[var(--border)]">
            <h2 className="text-xl font-bold mb-4">Sell {sellSide}</h2>
            <div className="mb-4 bg-[var(--surface2)] p-3 rounded text-sm">
              <div className="flex justify-between"><span>Available:</span><span className="font-bold">{(sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares).toFixed(2)}</span></div>
            </div>
            <input type="number" value={sellAmount} onChange={(e) => setSellAmount(e.target.value)} className="w-full bg-[var(--surface2)] border border-[var(--border2)] rounded p-2 mb-4" placeholder="Amount to sell" />
            {sellPreview && <p className="mb-4 text-xs text-[var(--green-bright)] font-mono">Est. Payout: ${sellPreview.payout.toFixed(2)}</p>}
            <div className="flex gap-2">
              <button onClick={handleSell} disabled={selling || !sellAmount} className="flex-1 bg-[var(--red)] text-white py-2 rounded">{selling ? '...' : 'Confirm'}</button>
              <button onClick={() => setShowSellModal(false)} className="flex-1 bg-[var(--surface3)] py-2 rounded">Cancel</button>
            </div>
          </div>
        </div>
      )}
      <ToastStack toasts={toasts} onDismiss={removeToast} onConfirm={resolveConfirm} />
    </div>
  );
}

function PositionCard({ side, shares, invested, exitValue, onSell, canSell }) {
  const pnl = exitValue - invested;
  return (
    <div className="rounded-md border border-[var(--border2)] bg-[var(--surface3)] p-3">
      <div className="flex justify-between mb-2">
        <span className={`font-mono text-[0.68rem] font-bold ${side === 'YES' ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>{side}</span>
        <span className="text-sm font-bold">{shares.toFixed(1)} shares</span>
      </div>
      <div className="text-[0.65rem] space-y-1">
        <div className="flex justify-between text-[var(--text-dim)]"><span>Invested:</span><span>${invested.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>Exit:</span><span className="text-[var(--amber-bright)] font-bold">${exitValue.toFixed(2)}</span></div>
        <div className="flex justify-between"><span>P/L:</span><span className={pnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}>${pnl.toFixed(2)}</span></div>
      </div>
      <button onClick={onSell} disabled={!canSell} className="mt-2 w-full bg-[var(--red)] text-white py-1 rounded text-xs font-bold uppercase">Sell</button>
    </div>
  );
}
