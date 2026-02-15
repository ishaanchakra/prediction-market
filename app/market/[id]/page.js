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
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';
import { getPublicDisplayName } from '@/utils/displayName';
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

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

function round2(num) {
  return Math.round(num * 100) / 100;
}

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
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [currentDisplayName, setCurrentDisplayName] = useState('user');
  const [newsItems, setNewsItems] = useState([]);
  const [marketStats, setMarketStats] = useState({ totalTraded: 0, bettors: 0 });
  const [topBettors, setTopBettors] = useState([]);
  const [relatedMarkets, setRelatedMarkets] = useState([]);
  const { toasts, notifyError, notifySuccess, confirmToast, removeToast, resolveConfirm } = useToastQueue();

  const marketStatus = getMarketStatus(market);
  const canTrade = currentUser && isTradeableMarket(market);
  const isLocked = marketStatus === MARKET_STATUS.LOCKED;
  const isResolved = marketStatus === MARKET_STATUS.RESOLVED;
  const isCancelled = marketStatus === MARKET_STATUS.CANCELLED;
  const userSide = userPosition.yesShares > 0 ? 'YES' : userPosition.noShares > 0 ? 'NO' : null;

  const isAdminUser = useMemo(() => {
    return !!(currentUser?.email && ADMIN_EMAILS.includes(currentUser.email));
  }, [currentUser]);

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
      timestamp: comment.timestamp?.toDate?.() || comment.createdAt?.toDate?.() || new Date(),
      data: comment
    }));

    const news = newsItems.map((newsItem) => ({
      id: `news-${newsItem.id}`,
      type: 'NEWS',
      timestamp: newsItem.timestamp?.toDate?.() || new Date(),
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
          const shares = Number(bet.shares || 0);
          const amount = Number(bet.amount || 0);
          if (bet.side === 'YES') {
            if (bet.type === 'SELL') {
              yesShares -= Math.abs(shares);
              yesInvested -= Math.abs(amount);
            } else {
              yesShares += shares;
              yesInvested += amount;
            }
          } else if (bet.side === 'NO') {
            if (bet.type === 'SELL') {
              noShares -= Math.abs(shares);
              noInvested -= Math.abs(amount);
            } else {
              noShares += shares;
              noInvested += amount;
            }
          }
        });

        const clean = (value) => (Math.abs(value) < 0.001 ? 0 : value);
        setUserPosition({
          yesShares: clean(yesShares),
          noShares: clean(noShares),
          yesInvested: clean(yesInvested),
          noInvested: clean(noInvested)
        });
      } catch (error) {
        console.error('Error fetching user position:', error);
      }
    }

    fetchUserPosition();
  }, [currentUser, params.id, market?.probability]);

  useEffect(() => {
    if (!market?.outstandingShares) return;

    try {
      const poolYes = Math.max(0, market.outstandingShares.yes ?? 0);
      const poolNo = Math.max(0, market.outstandingShares.no ?? 0);

      const clampedYesShares = Math.min(userPosition.yesShares, poolYes);
      const clampedNoShares = Math.min(userPosition.noShares, poolNo);

      const yesExit = clampedYesShares > 0
        ? calculateSell(market.outstandingShares, clampedYesShares, 'YES', market.b).payout
        : 0;
      const noExit = clampedNoShares > 0
        ? calculateSell(market.outstandingShares, clampedNoShares, 'NO', market.b).payout
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
        const totalTraded = trades.reduce((sum, trade) => sum + Math.abs(Number(trade.amount || 0)), 0);
        const bettors = new Set(trades.map((trade) => trade.userId)).size;
        setMarketStats({ totalTraded, bettors });

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
    async function fetchSidebarData() {
      if (!params.id) return;
      try {
        const betsQ = query(collection(db, 'bets'), where('marketId', '==', params.id));
        const betsSnap = await getDocs(betsQ);

        const positionMap = new Map();
        betsSnap.docs.forEach((snapshotDoc) => {
          const bet = snapshotDoc.data();
          if (!bet.userId) return;

          const entry = positionMap.get(bet.userId) || {
            userId: bet.userId,
            yesShares: 0,
            noShares: 0,
            invested: 0
          };

          const shares = Number(bet.shares || 0);
          const amount = Number(bet.amount || 0);

          if (bet.type === 'SELL') {
            if (bet.side === 'YES') entry.yesShares -= Math.abs(shares);
            if (bet.side === 'NO') entry.noShares -= Math.abs(shares);
            entry.invested -= Math.abs(amount);
          } else {
            if (bet.side === 'YES') entry.yesShares += shares;
            if (bet.side === 'NO') entry.noShares += shares;
            entry.invested += amount;
          }

          positionMap.set(bet.userId, entry);
        });

        const top = Array.from(positionMap.values())
          .map((entry) => ({
            ...entry,
            yesShares: Math.abs(entry.yesShares) < 0.001 ? 0 : entry.yesShares,
            noShares: Math.abs(entry.noShares) < 0.001 ? 0 : entry.noShares
          }))
          .filter((entry) => entry.yesShares > 0.001 || entry.noShares > 0.001)
          .sort((a, b) => b.invested - a.invested)
          .slice(0, 5);

        const bettorRows = await Promise.all(
          top.map(async (entry) => {
            const userDoc = await getDoc(doc(db, 'users', entry.userId));
            const userData = userDoc.exists() ? userDoc.data() : {};
            const dominantSide = entry.yesShares >= entry.noShares ? 'YES' : 'NO';
            return {
              userId: entry.userId,
              dominantSide,
              dominantShares: Math.max(entry.yesShares, entry.noShares),
              invested: entry.invested,
              name: getPublicDisplayName({ id: entry.userId, ...userData })
            };
          })
        );
        setTopBettors(bettorRows);

        const relatedQ = query(collection(db, 'markets'), where('resolution', '==', null), orderBy('createdAt', 'desc'), limit(6));
        const relatedSnap = await getDocs(relatedQ);
        setRelatedMarkets(
          relatedSnap.docs
            .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
            .filter((entry) => entry.id !== params.id)
            .slice(0, 3)
        );
      } catch (error) {
        console.error('Error fetching sidebar data:', error);
      }
    }
    fetchSidebarData();
  }, [params.id, market?.probability]);

  useEffect(() => {
    async function fetchComments() {
      if (!params.id) return;
      setCommentsLoading(true);
      try {
        const commentsQuery = query(
          collection(db, 'comments'),
          where('marketId', '==', params.id),
          orderBy('timestamp', 'desc')
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
    async function fetchNewsItems() {
      if (!params.id) return;
      try {
        const newsQuery = query(
          collection(db, 'newsItems'),
          where('marketId', '==', params.id),
          orderBy('timestamp', 'desc')
        );
        const snapshot = await getDocs(newsQuery);
        setNewsItems(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
      } catch (error) {
        console.error('Error loading news items:', error);
      }
    }
    fetchNewsItems();
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
    try {
      const amount = parseFloat(betAmount);

      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (!userDoc.exists()) {
        notifyError('User profile not found. Please log out and log back in.');
        return;
      }

      const userData = userDoc.data();
      if (userData.weeklyRep < amount) {
        notifyError(`Insufficient balance. You have $${userData.weeklyRep.toFixed(2)} available.`);
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
      notifyError('Error placing bet. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSell() {
    if (!currentUser || !isTradeableMarket(market)) {
      notifyError('Selling is unavailable while this market is locked or closed.');
      return;
    }

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
      notifyError('Error selling shares. Please try again.');
    } finally {
      setSelling(false);
    }
  }

  async function handlePostComment() {
    if (!currentUser) return;
    if (!newComment.trim()) return;

    setPostingComment(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      const displayName = userDoc.exists() ? getPublicDisplayName({ id: currentUser.uid, ...userDoc.data() }) : (currentUser.email?.split('@')[0] || 'user');
      await addDoc(collection(db, 'comments'), {
        marketId: params.id,
        userId: currentUser.uid,
        username: displayName,
        userName: displayName,
        text: newComment.trim(),
        createdAt: new Date(),
        timestamp: new Date(),
        likes: 0,
        replyTo: null,
        userSide
      });
      setNewComment('');
      notifySuccess('Comment posted.');

      const commentsQuery = query(
        collection(db, 'comments'),
        where('marketId', '==', params.id),
        orderBy('timestamp', 'desc')
      );
      const snapshot = await getDocs(commentsQuery);
      setComments(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    } catch (error) {
      console.error('Error posting comment:', error);
      notifyError('Unable to post comment right now.');
    } finally {
      setPostingComment(false);
    }
  }

  async function handlePostReply(parentId) {
    if (!currentUser) return;
    if (!replyText.trim()) return;

    setPostingComment(true);
    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      const displayName = userDoc.exists() ? getPublicDisplayName({ id: currentUser.uid, ...userDoc.data() }) : (currentUser.email?.split('@')[0] || 'user');
      await addDoc(collection(db, 'comments'), {
        marketId: params.id,
        userId: currentUser.uid,
        username: displayName,
        userName: displayName,
        text: replyText.trim(),
        createdAt: new Date(),
        timestamp: new Date(),
        likes: 0,
        replyTo: parentId,
        userSide
      });
      setReplyText('');
      setReplyingTo(null);
      notifySuccess('Reply posted.');

      const commentsQuery = query(
        collection(db, 'comments'),
        where('marketId', '==', params.id),
        orderBy('timestamp', 'desc')
      );
      const snapshot = await getDocs(commentsQuery);
      setComments(snapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() })));
    } catch (error) {
      console.error('Error posting reply:', error);
      notifyError('Unable to post reply right now.');
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
      notifySuccess('Comment updated.');
    } catch (error) {
      console.error('Error updating comment:', error);
      notifyError('Unable to update comment.');
    }
  }

  async function handleDeleteComment(comment) {
    const isOwner = currentUser?.uid === comment.userId;
    if (!isOwner && !isAdminUser) {
      notifyError('Only the owner or an admin can delete this comment.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'comments', comment.id));
      setComments((prev) => prev.filter((item) => item.id !== comment.id));
      notifySuccess('Comment deleted.');
    } catch (error) {
      console.error('Error deleting comment:', error);
      notifyError('Unable to delete comment.');
    }
  }

  async function handleLikeComment(comment) {
    try {
      const nextLikes = Number(comment.likes || 0) + 1;
      await updateDoc(doc(db, 'comments', comment.id), { likes: nextLikes });
      setComments((prev) => prev.map((item) => (item.id === comment.id ? { ...item, likes: nextLikes } : item)));
    } catch (error) {
      console.error('Error liking comment:', error);
      notifyError('Unable to like comment.');
    }
  }

  async function handleShareMarket() {
    if (typeof window === 'undefined') return;
    const shareUrl = window.location.href;
    const shareTitle = market?.question || 'Predict Cornell market';
    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: 'Check out this market on Predict Cornell',
          url: shareUrl
        });
        notifySuccess('Shared.');
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        notifySuccess('Market link copied.');
        return;
      }
      notifyError('Share is unavailable on this browser.');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        notifyError('Unable to share right now.');
      }
    }
  }

  function handleFollowPlaceholder() {
    notifySuccess('Follow is coming soon.');
  }

  const openProbability = typeof market?.initialProbability === 'number' ? market.initialProbability : betHistory[0]?.probability ?? market?.probability ?? 0.5;
  const currentProbability = typeof market?.probability === 'number' ? market.probability : openProbability;
  const probabilityColor = currentProbability > 0.65 ? 'text-[var(--green-bright)]' : currentProbability < 0.35 ? 'text-[var(--red)]' : 'text-[var(--amber-bright)]';
  const daysRemaining = market?.resolutionDate?.toDate
    ? Math.max(0, Math.ceil((market.resolutionDate.toDate().getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const firstHistoryProbability = typeof betHistory[0]?.probability === 'number' ? betHistory[0].probability : openProbability;
  const deltaFromStart = currentProbability - firstHistoryProbability;
  const deltaClass = deltaFromStart >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]';
  const deltaArrow = deltaFromStart >= 0 ? '↑' : '↓';
  const deltaText = `${deltaArrow} ${deltaFromStart >= 0 ? '+' : ''}${Math.round(deltaFromStart * 100)}% from first trade`;
  const resolutionRulesText = typeof market?.resolutionRules === 'string' && market.resolutionRules.trim()
    ? market.resolutionRules.trim()
    : null;

  const marketTags = Array.isArray(market?.tags) ? market.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
  const categoryLabel = market?.category || market?.topic || marketTags[0] || 'Campus';
  const truncatedQuestion = (market?.question || '').length > 36 ? `${market.question.slice(0, 36)}...` : (market?.question || 'Market');
  const statusTagLabel = isResolved ? 'Resolved' : isCancelled ? 'Cancelled' : isLocked ? 'Locked' : '● Live';
  const statusTagClass = isResolved
    ? 'border-[rgba(22,163,74,.28)] bg-[rgba(22,163,74,.08)] text-[var(--green-bright)]'
    : isCancelled
      ? 'border-[var(--border2)] bg-[var(--surface2)] text-[var(--text-dim)]'
      : isLocked
        ? 'border-[rgba(217,119,6,.28)] bg-[rgba(217,119,6,.08)] text-[var(--amber-bright)]'
        : 'border-[rgba(22,163,74,.28)] bg-[rgba(22,163,74,.08)] text-[var(--green-bright)]';

  const chartNewsMarkers = newsItems
    .map((newsItem) => {
      const time = safeDate(newsItem.timestamp).getTime();
      return {
        id: newsItem.id,
        timestamp: time,
        probability: typeof newsItem.probabilityAtPost === 'number' ? newsItem.probabilityAtPost : currentProbability
      };
    })
    .filter((marker) => Number.isFinite(marker.timestamp))
    .slice(0, 4);

  const renderReplyComposer = (parentId) => (
    replyingTo === parentId ? (
      <div className="mt-[0.6rem] ml-4 border-l border-[var(--border)] pl-4">
        <textarea
          placeholder="Write a reply..."
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          className="min-h-[52px] w-full resize-none rounded-[5px] border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 text-[0.82rem] text-[var(--text)]"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={() => {
              setReplyingTo(null);
              setReplyText('');
            }}
            className="bg-transparent font-mono text-[0.6rem] uppercase text-[var(--text-muted)]"
          >
            Cancel
          </button>
          <button
            onClick={() => handlePostReply(parentId)}
            className="rounded bg-[var(--red)] px-4 py-1.5 font-mono text-[0.62rem] uppercase text-white hover:bg-[var(--red-dim)]"
          >
            Reply →
          </button>
        </div>
      </div>
    ) : null
  );

  const renderCommentCard = (comment, isReply = false) => {
    const isOwner = currentUser?.uid === comment.userId;
    const canDelete = isOwner || isAdminUser;
    const displayName = comment.username || comment.userName || 'trader';
    const sideClass = comment.userSide === 'YES'
      ? 'bg-[rgba(22,163,74,.1)] text-[var(--green-bright)] border border-[rgba(22,163,74,.2)]'
      : 'bg-[var(--red-glow)] text-[var(--red)] border border-[rgba(220,38,38,.2)]';

    return (
      <div className={`${isReply ? 'mt-3 border-l border-[var(--border)] pl-4' : ''}`}>
        <div className={`rounded-md border border-[var(--border)] ${isReply ? 'bg-[var(--surface2)]' : 'bg-[var(--surface)]'} p-4 transition-colors hover:bg-[var(--surface2)]`}>
          <div className="mb-2 flex items-center gap-2">
            <div className="h-6 w-6 rounded-full border border-[var(--border2)] bg-[var(--surface3)] font-mono text-[0.52rem] font-bold text-[var(--text-dim)] flex items-center justify-center">
              {getInitials(displayName)}
            </div>
            <span className="text-sm font-semibold text-[var(--text)]">{displayName}</span>
            {comment.userSide && (
              <span className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[0.58rem] font-bold uppercase ${sideClass}`}>
                {comment.userSide}
              </span>
            )}
            <span className="font-mono text-[0.58rem] text-[var(--text-muted)]">
              {safeDate(comment.timestamp || comment.createdAt).toLocaleString()}
            </span>
          </div>

          {editingCommentId === comment.id ? (
            <div className="space-y-2">
              <textarea
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                className="w-full rounded border border-[var(--border2)] bg-[var(--surface2)] p-2 text-sm text-[var(--text)]"
                rows={2}
                maxLength={400}
              />
              <div className="flex gap-2">
                <button onClick={() => handleSaveComment(comment.id)} className="rounded bg-[var(--red)] px-2 py-1 text-xs font-semibold text-white hover:bg-[var(--red-dim)]">
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingCommentId(null);
                    setEditingText('');
                  }}
                  className="rounded bg-[var(--surface3)] px-2 py-1 text-xs font-semibold text-[var(--text-dim)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-6 text-[var(--text-dim)] whitespace-pre-wrap">{comment.text}</p>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => handleLikeComment(comment)} className="font-mono text-[0.58rem] text-[var(--text-muted)] hover:text-[var(--text-dim)]">
              ♥ {Number(comment.likes || 0)}
            </button>
            <button
              onClick={() => {
                if (!currentUser) {
                  notifyError('Sign in to reply.');
                  return;
                }
                setReplyingTo(comment.id);
                setReplyText('');
              }}
              className="font-mono text-[0.58rem] text-[var(--text-muted)] hover:text-[var(--text-dim)]"
            >
              ↩ reply
            </button>
            {currentUser && editingCommentId !== comment.id && isOwner && (
              <button
                onClick={() => {
                  setEditingCommentId(comment.id);
                  setEditingText(comment.text);
                }}
                className="font-mono text-[0.58rem] text-[var(--text-muted)] hover:text-[var(--text-dim)]"
              >
                Edit
              </button>
            )}
            {currentUser && editingCommentId !== comment.id && canDelete && (
              <button onClick={() => handleDeleteComment(comment)} className="font-mono text-[0.58rem] text-[var(--red)] hover:text-[var(--red-dim)]">
                Delete
              </button>
            )}
          </div>
        </div>
        {renderReplyComposer(comment.id)}
      </div>
    );
  };

  if (loading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;
  if (!market) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Market not found</div>;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="mx-auto max-w-[1200px]" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0, minHeight: 'calc(100vh - 56px)' }}>
        <main style={{ borderRight: '1px solid var(--border)', padding: '2rem' }}>
          <div className="mb-6 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.05em] text-[var(--text-muted)]">
            <Link href="/markets/active" className="text-[var(--text-dim)] hover:text-[var(--text)]">Markets</Link>
            <span>/</span>
            <span className="text-[var(--text-dim)]">{categoryLabel}</span>
            <span>/</span>
            <span>{truncatedQuestion}</span>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {market?.category && (
              <span className="rounded border border-[var(--red-dim)] bg-[var(--red-glow)] px-2 py-1 font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--red)]">{market.category}</span>
            )}
            <span className={`rounded border px-2 py-1 font-mono text-[0.55rem] uppercase tracking-[0.08em] ${statusTagClass}`}>{statusTagLabel}</span>
          </div>

          <h1 className="mb-7 max-w-[640px] font-display text-[2rem] leading-tight tracking-[-0.015em] text-[var(--text)]">{market.question}</h1>

          <div className="mb-6 flex flex-wrap items-end gap-8 border-b border-[var(--border)] pb-6">
            <div>
              <span className={`block font-mono text-[4.5rem] font-bold leading-none tracking-[-0.06em] ${probabilityColor}`}>
                {Math.round(currentProbability * 100)}%
              </span>
              <span className={`mt-1 block font-mono text-[0.68rem] ${deltaClass}`}>{deltaText}</span>
              <span className="mt-1 block font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">chance YES</span>
            </div>
            <div className="ml-auto grid grid-cols-3 gap-6 pb-2">
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

          {isLocked && (
            <div className="mb-6 rounded-lg border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] p-3 text-sm text-[#f59e0b]">
              Trading is locked by admin. You can view history and comments, but cannot buy or sell until it is unlocked.
            </div>
          )}
          {isCancelled && (
            <div className="mb-4 rounded-lg border border-[var(--border)] border-l-[3px] border-l-[var(--amber-bright)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]">
              This market was cancelled. Refunds were issued based on each user&apos;s net invested amount.
            </div>
          )}

          <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="mb-2 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              <span className="inline-block h-px w-3 bg-[var(--red)]" />
              How this resolves
            </p>
            <p className="mb-2 text-sm text-[var(--text-dim)]">
              This market resolves YES if the rule below is met by the resolution criteria. Otherwise, it resolves NO.
            </p>
            <p className="text-sm leading-6 text-[var(--text)]">
              {resolutionRulesText || 'No specific resolution rule has been posted yet. Trade carefully and check comments for clarifications.'}
            </p>
          </div>

          <div className="mb-7">
            <ResponsiveContainer width="100%" height={170}>
              <ComposedChart data={betHistory} margin={{ top: 6, right: 6, left: -14, bottom: 8 }}>
                <defs>
                  <linearGradient id="probGradientFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#DC2626" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#DC2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1a1a1a" vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  stroke="#333"
                  tick={{ fill: '#3D3B38', fontSize: 9, fontFamily: 'Space Mono' }}
                  tickFormatter={(timestamp) => new Date(timestamp).toLocaleDateString('en-US', { weekday: 'short' })}
                />
                <YAxis
                  domain={[0, 1]}
                  stroke="#333"
                  ticks={[0.25, 0.5, 0.75]}
                  tick={{ fill: '#3D3B38', fontSize: 9, fontFamily: 'Space Mono' }}
                  tickFormatter={(value) => `${Math.round(value * 100)}%`}
                />
                {chartNewsMarkers.map((marker) => (
                  <ReferenceLine key={`news-line-${marker.id}`} x={marker.timestamp} stroke="var(--amber)" strokeDasharray="3 3" strokeOpacity={0.5} />
                ))}
                {chartNewsMarkers.map((marker) => (
                  <ReferenceDot
                    key={`news-dot-${marker.id}`}
                    x={marker.timestamp}
                    y={marker.probability}
                    r={3}
                    fill="var(--amber-bright)"
                    stroke="var(--bg)"
                    strokeWidth={1}
                  />
                ))}
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-lg">
                        <p className="font-mono text-[0.62rem] text-[var(--text-muted)]">{new Date(label).toLocaleString()}</p>
                        <p className="font-mono text-sm font-bold text-[var(--text)]">{Math.round(payload[0].value * 100)}%</p>
                      </div>
                    );
                  }}
                />
                <Area type="monotone" dataKey="probability" fill="url(#probGradientFill)" stroke="none" />
                <Line type="monotone" dataKey="probability" stroke="var(--red)" strokeWidth={1.5} dot={false} />
                <ReferenceDot
                  x={betHistory[betHistory.length - 1]?.timestamp}
                  y={betHistory[betHistory.length - 1]?.probability}
                  r={3}
                  fill="var(--red)"
                  stroke="rgba(220,38,38,0.15)"
                  strokeWidth={6}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {currentUser && !isResolved && !isCancelled && (userPosition.yesShares > 0 || userPosition.noShares > 0) && (
            <div className="mb-6 border-b border-[var(--border)] bg-[var(--surface)] pb-4">
              <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Your Position</p>
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

          <div className="mb-8 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-5 relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[var(--red)] to-transparent" />
            {isResolved ? (
              <div className="py-3 text-center">
                <p className="font-mono text-4xl font-bold text-[var(--text)]">{market.resolution === 'YES' ? 'YES' : 'NO'}</p>
                <p className="mt-1 text-sm text-[var(--text-dim)]">Winning side pays out one point per share.</p>
              </div>
            ) : isCancelled ? (
              <div className="py-3 text-center">
                <p className="font-mono text-xl font-bold text-[var(--text)]">Market Cancelled</p>
                <p className="mt-1 text-sm text-[var(--text-dim)]">This market no longer accepts trades.</p>
              </div>
            ) : (
              <>
                <p className="mb-4 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">Place a bet</p>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  {(() => {
                    const yesProb = Number(market?.probability || 0.5);
                    const noProb = 1 - yesProb;
                    const yesMult = yesProb > 0 ? 1 / yesProb : 0;
                    const noMult = noProb > 0 ? 1 / noProb : 0;
                    return (
                      <>
                        <button
                          onClick={() => setSelectedSide('YES')}
                          disabled={!canTrade}
                          className={`rounded-md border px-4 py-3 text-center transition ${
                            selectedSide === 'YES'
                              ? 'border-[var(--green-bright)] bg-[rgba(22,163,74,.08)]'
                              : 'border-[var(--border2)] bg-[var(--surface2)] text-[var(--text)] hover:bg-[var(--surface3)]'
                          } disabled:opacity-50`}
                        >
                          <span className="mb-1 block font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">YES</span>
                          <span className="block font-mono text-[1.35rem] font-bold text-[var(--green-bright)]">{Math.round(yesProb * 100)}%</span>
                          <span className="mt-1 block font-mono text-[0.58rem] text-[var(--text-muted)]">~{yesMult.toFixed(2)}x return</span>
                        </button>
                        <button
                          onClick={() => setSelectedSide('NO')}
                          disabled={!canTrade}
                          className={`rounded-md border px-4 py-3 text-center transition ${
                            selectedSide === 'NO'
                              ? 'border-[var(--red)] bg-[var(--red-glow)]'
                              : 'border-[var(--border2)] bg-[var(--surface2)] text-[var(--text)] hover:bg-[var(--surface3)]'
                          } disabled:opacity-50`}
                        >
                          <span className="mb-1 block font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">NO</span>
                          <span className="block font-mono text-[1.35rem] font-bold text-[var(--red)]">{Math.round(noProb * 100)}%</span>
                          <span className="mt-1 block font-mono text-[0.58rem] text-[var(--text-muted)]">~{noMult.toFixed(2)}x return</span>
                        </button>
                      </>
                    );
                  })()}
                </div>
                <div className="mb-3 flex gap-2">
                  <input
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    placeholder={currentUser ? '$0.00' : 'Sign in to trade'}
                    className="flex-1 rounded border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 text-[var(--text)]"
                    min="1"
                    disabled={!canTrade}
                  />
                  <button
                    onClick={handlePlaceBet}
                    disabled={!currentUser || !betAmount || submitting || !isTradeableMarket(market)}
                    className="whitespace-nowrap rounded bg-[var(--red)] px-5 py-2 font-mono text-[0.7rem] uppercase tracking-[0.06em] text-white hover:bg-[var(--red-dim)] disabled:bg-[var(--surface3)] disabled:cursor-not-allowed"
                  >
                    {submitting ? 'Placing...' : `Bet ${selectedSide} →`}
                  </button>
                </div>
                {preview && currentUser && (
                  <div className="flex items-center justify-between rounded border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 font-mono text-[0.65rem] text-[var(--text-muted)]">
                    <span className="flex items-center gap-1">
                      You&apos;ll receive approx. {preview.shares.toFixed(1)} shares
                      <InfoTooltip
                        label="Shares help"
                        text="Shares are your position size. If your side wins, your shares become payout."
                      />
                    </span>
                    <span>
                      new prob: <em className="not-italic text-[var(--green-bright)]">{Math.round(preview.newProbability * 100)}%</em>
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mb-5 flex border-b border-[var(--border)]">
            <span className="mb-[-1px] border-b-2 border-[var(--red)] px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.06em] text-[var(--text)]">Timeline</span>
            <span className="mb-[-1px] border-b-2 border-transparent px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">Activity</span>
          </div>

          {commentsLoading ? (
            <p className="font-mono text-sm text-[var(--text-muted)]">Loading timeline...</p>
          ) : timelineItems.length === 0 ? (
            <p className="font-mono text-sm text-[var(--text-muted)]">No timeline items yet.</p>
          ) : (
            <div className="relative max-h-[560px] space-y-4 overflow-y-auto pl-11">
              <div className="pointer-events-none absolute bottom-0 left-[15px] top-0 w-px bg-[var(--border)]" />
              {timelineItems.map((item) => {
                if (item.type === 'NEWS') {
                  const news = item.data;
                  const before = Number(news.probabilityAtPost || 0);
                  const after = Number(market?.probability || before);
                  const delta = after - before;
                  const newsReplies = (repliesByParent[news.id] || []).sort(
                    (a, b) => safeDate(a.timestamp || a.createdAt) - safeDate(b.timestamp || b.createdAt)
                  );
                  return (
                    <div key={item.id} className="relative pb-4">
                      <span className="absolute -left-[34px] top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--amber)] bg-[rgba(217,119,6,.12)] text-[0.5rem]">⚡</span>
                      <div className="rounded-r-md border border-[var(--border)] border-l-[3px] border-l-[var(--amber-bright)] bg-[var(--surface)] p-4">
                        <p className="mb-2 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--amber-bright)]">News · {news.source}</p>
                        <a href={news.url} target="_blank" rel="noreferrer" className="mb-3 block text-sm font-semibold text-[var(--text)] hover:text-[var(--amber-bright)]">
                          {news.headline}
                        </a>
                        <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface2)] px-3 py-2">
                          <span className="font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">Snapshot</span>
                          <span className="font-mono text-xs font-bold text-[var(--text-dim)]">{Math.round(before * 100)}%</span>
                          <span className="font-mono text-xs text-[var(--text-muted)]">→</span>
                          <span className="font-mono text-xs font-bold text-[var(--text)]">{Math.round(after * 100)}%</span>
                          <span className={`ml-auto font-mono text-xs ${delta >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                            {delta >= 0 ? '+' : ''}{Math.round(delta * 100)}%
                          </span>
                        </div>
                        <div className="mt-2">
                          <button
                            onClick={() => {
                              if (!currentUser) {
                                notifyError('Sign in to reply.');
                                return;
                              }
                              setReplyingTo(news.id);
                              setReplyText('');
                            }}
                            className="font-mono text-[0.58rem] text-[var(--text-muted)] hover:text-[var(--text-dim)]"
                          >
                            ↩ comment on this
                          </button>
                        </div>
                        {renderReplyComposer(news.id)}
                        {newsReplies.map((reply) => (
                          <div key={reply.id}>{renderCommentCard(reply, true)}</div>
                        ))}
                      </div>
                      <p className="mt-1 pl-1 font-mono text-[0.58rem] text-[var(--text-muted)]">{safeDate(news.timestamp).toLocaleString()}</p>
                    </div>
                  );
                }

                if (item.type === 'EVENT') {
                  const event = item.data;
                  const up = event.delta >= 0;
                  return (
                    <div key={item.id} className="relative pb-4">
                      <span className="absolute -left-[34px] top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--red-dim)] bg-[var(--red-glow)] text-[0.48rem]">◆</span>
                      <div className="flex items-center justify-between gap-3 rounded border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
                        <p className="font-mono text-[0.68rem] text-[var(--text-dim)]">
                          <strong className="text-[var(--red)]">{Math.round(Math.abs(event.delta) * 100)}% move</strong> — YES from {Math.round((event.before || 0) * 100)}% to {Math.round((event.after || 0) * 100)}%
                        </p>
                        <span className={`font-mono text-[0.75rem] font-bold ${up ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                          {Math.round((event.before || 0) * 100)}% → {Math.round((event.after || 0) * 100)}%
                        </span>
                      </div>
                      <p className="mt-1 pl-1 font-mono text-[0.58rem] text-[var(--text-muted)]">{safeDate(item.timestamp).toLocaleString()}</p>
                    </div>
                  );
                }

                const comment = item.data;
                const replies = (repliesByParent[comment.id] || []).sort((a, b) => safeDate(a.timestamp || a.createdAt) - safeDate(b.timestamp || b.createdAt));
                return (
                  <div key={item.id} className="relative pb-4">
                    <span className="absolute -left-[34px] top-1 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--border2)] bg-[var(--bg)] text-[0.5rem]">💬</span>
                    {renderCommentCard(comment)}
                    {replies.map((reply) => (
                      <div key={reply.id}>{renderCommentCard(reply, true)}</div>
                    ))}
                    <p className="mt-1 pl-1 font-mono text-[0.58rem] text-[var(--text-muted)]">{safeDate(comment.timestamp || comment.createdAt).toLocaleString()}</p>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-6 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 relative">
            <div className="pointer-events-none absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-[var(--red)] to-transparent" />
            {currentUser ? (
              <>
                <div className="mb-3 flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full border border-[var(--red-dim)] bg-[var(--red-glow)] font-mono text-[0.6rem] font-bold text-[var(--red)] flex items-center justify-center">
                    {getInitials(currentDisplayName)}
                  </div>
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="What's your take? Your position shows automatically."
                    maxLength={400}
                    className="min-h-[64px] flex-1 rounded border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 text-sm text-[var(--text)]"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[0.58rem] text-[var(--text-muted)]">
                    posting as {currentDisplayName} {userSide ? `· ${userSide} bettor` : '· no position'}
                  </span>
                  <button
                    onClick={handlePostComment}
                    disabled={!newComment.trim() || postingComment}
                    className="rounded bg-[var(--red)] px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.06em] text-white hover:bg-[var(--red-dim)] disabled:bg-[var(--surface3)]"
                  >
                    {postingComment ? 'Posting...' : 'Post →'}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--text-dim)]">
                <Link href="/login" className="underline">Sign in</Link> to join the discussion.
              </p>
            )}
          </div>
        </main>

        <aside className="space-y-8" style={{ padding: '2rem' }}>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleShareMarket} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-center font-mono text-[0.62rem] uppercase tracking-[0.05em] text-[var(--text-dim)] hover:text-[var(--text)]">
              ↗ Share
            </button>
            <button onClick={handleFollowPlaceholder} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-center font-mono text-[0.62rem] uppercase tracking-[0.05em] text-[var(--text-dim)] hover:text-[var(--text)]">
              ⊕ Follow
            </button>
          </div>

          <section>
            <p className="mb-3 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <span className="inline-block h-px w-3 bg-[var(--red)]" />
              Whale Watch
            </p>
            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {topBettors.length === 0 ? (
                <p className="px-4 py-3 text-xs text-[var(--text-dim)]">No bettors yet.</p>
              ) : topBettors.map((bettor, idx) => (
                <div key={`${bettor.userId}-${idx}`} className="grid grid-cols-[20px_1fr_auto_auto] items-center gap-2 border-b border-[var(--border)] px-4 py-3 last:border-b-0 hover:bg-[var(--surface2)]">
                  <span className={`text-center font-mono text-[0.6rem] ${idx === 0 ? 'text-[var(--amber-bright)]' : 'text-[var(--text-muted)]'}`}>{idx + 1}</span>
                  <span className="text-sm text-[var(--text)]">{bettor.name}</span>
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[0.56rem] font-bold ${bettor.dominantSide === 'YES' ? 'bg-[rgba(22,163,74,.1)] text-[var(--green-bright)]' : 'bg-[var(--red-glow)] text-[var(--red)]'}`}>
                    {bettor.dominantSide}
                  </span>
                  <span className="text-right font-mono text-[0.72rem] font-bold text-[var(--amber-bright)]">${bettor.invested.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-3 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <span className="inline-block h-px w-3 bg-[var(--red)]" />
              Related Markets
            </p>
            <div className="space-y-2">
              {relatedMarkets.length === 0 ? (
                <p className="text-xs text-[var(--text-dim)]">No related markets.</p>
              ) : relatedMarkets.map((entry) => (
                <Link key={entry.id} href={`/market/${entry.id}`} className="flex items-center justify-between rounded border border-[var(--border)] bg-[var(--surface)] px-4 py-3 hover:border-[var(--border2)] hover:bg-[var(--surface2)]">
                  <span className="mr-3 text-sm leading-5 text-[var(--text-dim)]">{entry.question}</span>
                  <span className="whitespace-nowrap font-mono text-[0.9rem] font-bold text-[var(--amber-bright)]">{Math.round((entry.probability || 0) * 100)}%</span>
                </Link>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {showSellModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[var(--surface)] rounded-xl p-6 max-w-md w-full shadow-xl border border-[var(--border)]">
            <h2 className="text-2xl font-bold mb-4 text-[var(--text)]">Sell {sellSide} Shares</h2>

            <div className="bg-[var(--surface2)] rounded-lg p-4 mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-[var(--text-dim)]">Available:</span>
                <span className="font-semibold">{(sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares).toFixed(2)} shares</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--text-dim)]">Exit all now:</span>
                <span className="font-bold text-[var(--green-bright)]">${(sellSide === 'YES' ? exitValues.yesExit : exitValues.noExit).toFixed(2)}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-[var(--text-dim)] mb-2">Shares to Sell</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="flex-1 rounded-lg border border-[var(--border2)] bg-[var(--surface2)] px-4 py-2 text-[var(--text)]"
                  min="0.01"
                  step="0.01"
                  max={sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares}
                  disabled={!isTradeableMarket(market)}
                />
                <button
                  onClick={() => setSellAmount((sellSide === 'YES' ? userPosition.yesShares : userPosition.noShares).toString())}
                  className="px-4 py-2 bg-[var(--surface3)] text-[var(--text-dim)] rounded-lg font-semibold hover:bg-[var(--surface3)] transition-colors text-sm"
                  disabled={!isTradeableMarket(market)}
                >
                  Max
                </button>
              </div>
            </div>

            {sellPreview && (
              <div className="bg-[var(--surface2)] border border-[var(--border2)] rounded-lg p-4 mb-4">
                <p className="text-sm text-[var(--text-dim)] mb-2">You will receive now:</p>
                <p className="font-bold text-2xl text-[var(--green-bright)]">${sellPreview.payout.toFixed(2)}</p>
                <p className="text-xs text-[var(--text-dim)] mt-2">New market probability: {Math.round(sellPreview.newProbability * 100)}%</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSell}
                disabled={!sellAmount || selling || parseFloat(sellAmount) <= 0 || !isTradeableMarket(market)}
                className="flex-1 rounded-lg bg-[var(--red)] px-6 py-3 font-semibold text-white hover:bg-[var(--red-dim)] disabled:bg-[var(--surface3)] disabled:cursor-not-allowed"
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
                className="flex-1 bg-[var(--surface3)] text-[var(--text-dim)] py-3 px-6 rounded-lg font-semibold hover:bg-[var(--surface3)]"
              >
                Cancel
              </button>
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
  const isProfit = pnl >= 0;

  return (
    <div className="rounded-md border border-[var(--border2)] bg-[var(--surface3)] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className={`font-mono text-[0.68rem] font-bold uppercase ${side === 'YES' ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>{side}</span>
        <span className="text-lg font-bold text-[var(--text)]">{shares.toFixed(1)} shares</span>
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between text-[var(--text-dim)]">
          <span>You risked:</span>
          <span className="font-semibold">${invested.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--text-dim)]">Sell now for:</span>
          <span className="font-bold text-[var(--amber-bright)]">${exitValue.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[var(--text-dim)]">Current P/L:</span>
          <span className={`font-semibold ${isProfit ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
            {isProfit ? '+$' : '-$'}
            {Math.abs(pnl).toFixed(2)}
          </span>
        </div>
      </div>
      <button
        onClick={onSell}
        disabled={!canSell}
        className="mt-2 w-full rounded-lg bg-[var(--red)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--red-dim)] disabled:bg-[var(--surface3)] disabled:text-[var(--text-muted)]"
      >
        Sell {side}
      </button>
    </div>
  );
}
