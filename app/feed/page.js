'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth, db, functions } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  onSnapshot,
  orderBy,
  limit,
  addDoc,
  deleteDoc,
  updateDoc,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { MARKET_STATUS } from '@/utils/marketStatus';
import { getISOWeek } from '@/utils/isoWeek';
import { getPublicDisplayName } from '@/utils/displayName';

const DEFAULT_BET_AMOUNT = 100; // $100 per quick-take bet
const MAX_MARKETS = 30;
const CARD_EXIT_MS = 450;

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toMillis(value) {
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value);
  const ts = parsed.getTime();
  return Number.isNaN(ts) ? 0 : ts;
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

function clampProbability(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function probabilityTone(probability) {
  if (probability >= 0.6) {
    return {
      textClass: 'text-[var(--green-bright)]',
      barClass: 'bg-[var(--green-bright)]',
      stroke: 'var(--green-bright)',
      tone: 'yes'
    };
  }
  if (probability <= 0.4) {
    return {
      textClass: 'text-[var(--red)]',
      barClass: 'bg-[var(--red)]',
      stroke: 'var(--red)',
      tone: 'no'
    };
  }
  return {
    textClass: 'text-[var(--amber-bright)]',
    barClass: 'bg-[var(--amber-bright)]',
    stroke: 'var(--amber-bright)',
    tone: 'neutral'
  };
}

function formatResolvesLabel(market) {
  const rawDate = market?.resolutionDate?.toDate
    ? market.resolutionDate.toDate()
    : market?.resolutionDate
      ? new Date(market.resolutionDate)
      : null;

  if (!rawDate || Number.isNaN(rawDate.getTime())) return 'Resolves TBD';
  return `Resolves ${rawDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function formatEntryDate(value) {
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function sparklinePath(values) {
  const probs = Array.isArray(values) && values.length > 0 ? values : [0.5, 0.5];
  const normalized = probs.map((v) => clampProbability(v));
  const points = normalized.map((prob, index) => {
    const x = normalized.length === 1 ? 150 : (index / (normalized.length - 1)) * 300;
    const y = 52 - (prob * 42);
    return { x, y };
  });

  if (points.length === 1) {
    const point = points[0];
    return `M0,${point.y.toFixed(2)} L300,${point.y.toFixed(2)}`;
  }

  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ');
}

function Sparkline({ probabilities, strokeColor, gradientId }) {
  const linePath = sparklinePath(probabilities);
  const fillPath = `${linePath} L300,52 L0,52 Z`;

  return (
    <svg viewBox="0 0 300 52" preserveAspectRatio="none" className="h-[52px] w-full">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="1.8" opacity="0.95" />
    </svg>
  );
}

function formatCommentTime(value) {
  const ms = toMillis(value);
  if (!ms) return 'just now';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getInitials(name) {
  if (!name) return 'PC';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PC';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getCommentDisplayName(comment) {
  if (comment?.username && String(comment.username).trim()) return String(comment.username).trim();
  if (comment?.userName && String(comment.userName).trim()) return String(comment.userName).trim();
  if (comment?.displayName && String(comment.displayName).trim()) return String(comment.displayName).trim();
  if (comment?.userId) return `user-${String(comment.userId).slice(0, 6)}`;
  return 'trader';
}

export default function FeedPage() {
  const router = useRouter();
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [user, setUser] = useState(null);
  const [balance, setBalance] = useState(0);
  const [decisions, setDecisions] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [dragState, setDragState] = useState({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });
  const [exitDirection, setExitDirection] = useState(null);
  const [animatingOut, setAnimatingOut] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [currentDisplayName, setCurrentDisplayName] = useState('user');
  const [sellingMarketId, setSellingMarketId] = useState(null);
  const [showFfInterstitial, setShowFfInterstitial] = useState(false);

  const topCard = cards[currentIndex] || null;
  const topCardId = topCard?.id || null;
  const disableInteractions = submitting || animatingOut || !!sellingMarketId;
  const exitTimeoutRef = useRef(null);
  const dragRef = useRef(dragState);

  useEffect(() => {
    dragRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) {
        clearTimeout(exitTimeoutRef.current);
      }
    };
  }, []);

  const fetchCommentsForMarket = useCallback(async (marketId) => {
    if (!marketId) {
      setComments([]);
      setCommentsLoading(false);
      return;
    }

    setCommentsLoading(true);
    try {
      const commentsQuery = query(
        collection(db, 'comments'),
        where('marketId', '==', marketId),
        where('marketplaceId', '==', null),
        limit(200)
      );
      const snapshot = await getDocs(commentsQuery);
      const items = snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .sort((a, b) => toMillis(b.timestamp || b.createdAt) - toMillis(a.timestamp || a.createdAt));
      setComments(items);
    } catch (error) {
      console.error('Error loading feed comments:', error);
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, []);

  useEffect(() => {
    setCommentDraft('');
    setReplyDraft('');
    setReplyingTo(null);
    if (!topCardId) {
      setComments([]);
      setCommentsLoading(false);
      return;
    }
    fetchCommentsForMarket(topCardId);
  }, [fetchCommentsForMarket, topCardId]);

  const normalizedComments = useMemo(() => {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    return comments.map((comment) => {
      let replyTo = comment.replyTo || null;
      let orphanedReply = false;
      if (replyTo) {
        const parent = byId.get(replyTo);
        if (parent?.replyTo) {
          replyTo = parent.replyTo;
        }
        if (!byId.has(replyTo)) {
          orphanedReply = true;
        }
      }
      return { ...comment, _replyToRoot: replyTo, _orphanedReply: orphanedReply };
    });
  }, [comments]);

  const rootComments = useMemo(
    () => normalizedComments
      .filter((comment) => !comment._replyToRoot && !comment._orphanedReply)
      .sort((a, b) => toMillis(b.timestamp || b.createdAt) - toMillis(a.timestamp || a.createdAt)),
    [normalizedComments]
  );

  const repliesByParent = useMemo(() => normalizedComments.reduce((acc, comment) => {
    if (!comment._replyToRoot || comment._orphanedReply) return acc;
    if (!acc[comment._replyToRoot]) acc[comment._replyToRoot] = [];
    acc[comment._replyToRoot].push(comment);
    return acc;
  }, {}), [normalizedComments]);

  const loadFeedCards = useCallback(async (currentUser) => {
    const currentWeek = getISOWeek();

    const [marketsSnap, ffSnap] = await Promise.all([
      getDocs(
        query(
          collection(db, 'markets'),
          where('resolution', '==', null),
          where('marketplaceId', '==', null),
          limit(MAX_MARKETS)
        )
      ),
      getDocs(
        query(
          collection(db, 'markets'),
          where('isFiveFutures', '==', true),
          where('fiveFuturesWeek', '==', currentWeek)
        )
      )
    ]);

    const ffIds = new Set(ffSnap.docs.map((d) => d.id));

    const markets = marketsSnap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
      .filter((market) => market.status === MARKET_STATUS.OPEN);

    ffSnap.docs.forEach((d) => {
      if (!markets.find((m) => m.id === d.id)) {
        const data = { id: d.id, ...d.data() };
        if (data.status === MARKET_STATUS.OPEN) markets.push(data);
      }
    });

    if (markets.length === 0) return [];

    const marketIds = markets.map((market) => market.id);
    const userBetsByMarket = new Map(marketIds.map((marketId) => [marketId, []]));

    const marketIdChunks = chunkArray(marketIds, 10);
    for (const chunk of marketIdChunks) {
      const userBetsSnap = await getDocs(
        query(
          collection(db, 'bets'),
          where('userId', '==', currentUser.uid),
          where('marketId', 'in', chunk),
          where('marketplaceId', '==', null)
        )
      );

      userBetsSnap.docs.forEach((snapshotDoc) => {
        const bet = { id: snapshotDoc.id, ...snapshotDoc.data() };
        const existing = userBetsByMarket.get(bet.marketId) || [];
        existing.push(bet);
        userBetsByMarket.set(bet.marketId, existing);
      });
    }

    userBetsByMarket.forEach((bets, marketId) => {
      const sorted = [...bets].sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
      userBetsByMarket.set(marketId, sorted);
    });

    const sparklineEntries = await Promise.all(
      markets.map(async (market) => {
        const betsSnap = await getDocs(
          query(
            collection(db, 'bets'),
            where('marketId', '==', market.id),
            where('marketplaceId', '==', null),
            orderBy('timestamp', 'asc'),
            limit(50)
          )
        );

        const probabilities = betsSnap.docs
          .map((snapshotDoc) => Number(snapshotDoc.data()?.probability))
          .filter((probability) => Number.isFinite(probability));

        return [market.id, probabilities];
      })
    );

    const sparklineByMarket = new Map(sparklineEntries);

    const baseCards = markets.map((market) => {
      const probability = clampProbability(market.probability);
      const userMarketBets = userBetsByMarket.get(market.id) || [];
      const isFiveFutures = ffIds.has(market.id);

      let yesShares = 0;
      let noShares = 0;
      let userCostBasis = 0;

      userMarketBets.forEach((bet) => {
        const shares = Number(bet.shares || 0);
        const amount = Number(bet.amount || 0);
        const type = bet.type || 'BUY';

        if (bet.side === 'YES') {
          if (type === 'SELL') {
            yesShares -= Math.abs(shares);
          } else {
            yesShares += Math.abs(shares);
          }
        } else if (bet.side === 'NO') {
          if (type === 'SELL') {
            noShares -= Math.abs(shares);
          } else {
            noShares += Math.abs(shares);
          }
        }

        if (amount > 0) {
          userCostBasis += amount;
        }
      });

      if (Math.abs(yesShares) < 0.001) yesShares = 0;
      if (Math.abs(noShares) < 0.001) noShares = 0;

      const hasPosition = yesShares > 0 || noShares > 0;
      const firstBet = userMarketBets[0] || null;
      const firstBetProbability = Number(firstBet?.probability);
      const hasFirstBetProbability = Number.isFinite(firstBetProbability);
      const priceMoveDelta = hasFirstBetProbability ? probability - firstBetProbability : 0;
      const priceMovedSinceEntry = hasPosition && hasFirstBetProbability && Math.abs(priceMoveDelta) > 0.05;

      const unrealizedPnl = (yesShares * probability + noShares * (1 - probability)) - userCostBasis;
      const userSide = yesShares > noShares ? 'YES' : noShares > yesShares ? 'NO' : null;

      const section = isFiveFutures && !hasPosition
        ? 'Five Futures'
        : !hasPosition
          ? 'New markets'
          : priceMovedSinceEntry
            ? 'Your positions · moved'
            : 'Your positions · stable';

      const sectionColor = isFiveFutures && !hasPosition
        ? 'var(--red)'
        : !hasPosition
          ? 'var(--red)'
          : priceMovedSinceEntry
            ? 'var(--amber-bright)'
            : 'var(--text-muted)';

      return {
        id: market.id,
        question: market.question || 'Untitled market',
        category: market.category || 'General',
        resolvesLabel: formatResolvesLabel(market),
        probability,
        sparkline: sparklineByMarket.get(market.id) || [],
        totalVolume: Number(market.totalVolume || 0),
        traders: Number(market.traderCount || 0),
        userPosition: hasPosition ? { yesShares, noShares } : null,
        userSide,
        userCostBasis,
        unrealizedPnl,
        entryDate: firstBet?.timestamp || null,
        priceMovedSinceEntry,
        priceMovePoints: Math.round(priceMoveDelta * 100),
        section,
        sectionColor,
        isFiveFutures,
        fiveFuturesIndex: isFiveFutures ? (market.fiveFuturesIndex || 0) : Infinity
      };
    });

    const ffNew = baseCards
      .filter((card) => card.isFiveFutures && !card.userPosition)
      .sort((a, b) => a.fiveFuturesIndex - b.fiveFuturesIndex);
    const newMarkets = baseCards.filter((card) => !card.userPosition && !card.isFiveFutures);
    const movedPositions = baseCards.filter((card) => card.userPosition && card.priceMovedSinceEntry);
    const stablePositions = baseCards.filter((card) => card.userPosition && !card.priceMovedSinceEntry);

    return [...ffNew, ...newMarkets, ...movedPositions, ...stablePositions];
  }, []);

  useEffect(() => {
    let unsubscribeBalance = null;

    const unsubscribeAuth = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      setErrorMessage('');

      if (unsubscribeBalance) {
        unsubscribeBalance();
        unsubscribeBalance = null;
      }

      if (!currentUser) {
        setCards([]);
        setDecisions([]);
        setCurrentIndex(0);
        setLoading(false);
        setBalance(0);
        setCurrentDisplayName('user');
        setComments([]);
        setReplyingTo(null);
        router.push('/login?next=%2Ffeed');
        return;
      }

      unsubscribeBalance = onSnapshot(
        doc(db, 'users', currentUser.uid),
        (userDoc) => {
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setBalance(Number(userData?.balance || 0));
            setCurrentDisplayName(getPublicDisplayName({ id: currentUser.uid, ...userData }));
          } else {
            setBalance(0);
            setCurrentDisplayName(currentUser.email?.split('@')[0] || 'user');
          }
        },
        (error) => {
          console.error('Error listening to user balance:', error);
        }
      );

      setLoading(true);
      try {
        const nextCards = await loadFeedCards(currentUser);
        setCards(nextCards);
        setDecisions(Array(nextCards.length).fill(null));
        setCurrentIndex(0);
        setShowFfInterstitial(false);
      } catch (error) {
        console.error('Error loading feed cards:', error);
        setCards([]);
        setDecisions([]);
        setCurrentIndex(0);
        setErrorMessage('Unable to load markets right now.');
      } finally {
        setLoading(false);
      }
    });

    return () => {
      if (unsubscribeBalance) unsubscribeBalance();
      unsubscribeAuth();
    };
  }, [loadFeedCards, router]);

  const dismissTopCard = useCallback((direction, decision) => {
    if (!topCard) return;

    setExitDirection(direction);
    setAnimatingOut(true);

    if (exitTimeoutRef.current) {
      clearTimeout(exitTimeoutRef.current);
    }

    exitTimeoutRef.current = setTimeout(() => {
      setDecisions((prev) => {
        const next = [...prev];
        next[currentIndex] = decision;
        return next;
      });

      const nextIdx = currentIndex + 1;
      const nextCard = cards[nextIdx] || null;
      if (topCard.isFiveFutures && (!nextCard || !nextCard.isFiveFutures)) {
        setShowFfInterstitial(true);
      }

      setCurrentIndex(nextIdx);
      setDragState({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });
      setExitDirection(null);
      setAnimatingOut(false);
      setSubmitting(false);
    }, CARD_EXIT_MS);
  }, [cards, currentIndex, topCard]);

  const commitSwipe = useCallback(async (direction) => {
    if (!topCard || disableInteractions) return;

    setErrorMessage('');

    if (direction === 'up') {
      dismissTopCard('up', 'SKIP');
      return;
    }

    setSubmitting(true);
    try {
      const placeBetFn = httpsCallable(functions, 'placeBet');
      await placeBetFn({
        marketId: topCard.id,
        side: direction === 'right' ? 'YES' : 'NO',
        amount: DEFAULT_BET_AMOUNT,
        marketplaceId: null
      });

      dismissTopCard(direction, direction === 'right' ? 'YES' : 'NO');
    } catch (error) {
      console.error('Error placing feed bet:', error);
      setErrorMessage(getCallableErrorMessage(error, 'Error placing bet. Please try again.'));
      setSubmitting(false);
    }
  }, [disableInteractions, dismissTopCard, topCard]);

  const handleSell = useCallback(async (card) => {
    const side = card.userSide;
    if (!side || side === 'MIXED' || !card.userPosition) return;
    const sharesToSell = side === 'YES' ? card.userPosition.yesShares : card.userPosition.noShares;
    if (!(sharesToSell > 0)) return;

    setSellingMarketId(card.id);
    setErrorMessage('');
    try {
      const sellSharesFn = httpsCallable(functions, 'sellShares');
      await sellSharesFn({ marketId: card.id, side, sharesToSell, marketplaceId: null });
      dismissTopCard('up', 'SOLD');
    } catch (error) {
      console.error('Error selling position:', error);
      setErrorMessage(getCallableErrorMessage(error, 'Error selling position. Please try again.'));
    } finally {
      setSellingMarketId(null);
    }
  }, [dismissTopCard]);

  const handlePostComment = useCallback(async () => {
    if (!user || !topCard?.id) return;
    const text = commentDraft.trim();
    if (!text) return;

    setCommentSubmitting(true);
    try {
      await addDoc(collection(db, 'comments'), {
        marketId: topCard.id,
        marketplaceId: null,
        userId: user.uid,
        username: currentDisplayName || (user.email?.split('@')[0] || 'user'),
        userName: currentDisplayName || (user.email?.split('@')[0] || 'user'),
        text,
        createdAt: new Date(),
        timestamp: new Date(),
        likedBy: [],
        replyTo: null,
        userSide: topCard.userSide === 'YES' || topCard.userSide === 'NO' ? topCard.userSide : null
      });
      setCommentDraft('');
      await fetchCommentsForMarket(topCard.id);
    } catch (error) {
      console.error('Error posting feed comment:', error);
      setErrorMessage('Unable to post comment right now.');
    } finally {
      setCommentSubmitting(false);
    }
  }, [commentDraft, currentDisplayName, fetchCommentsForMarket, topCard?.id, topCard?.userSide, user]);

  const handlePostReply = useCallback(async (parentId) => {
    if (!user || !topCard?.id) return;
    const text = replyDraft.trim();
    if (!text) return;

    const parent = comments.find((comment) => comment.id === parentId);
    if (!parent) return;
    const rootParentId = parent.replyTo || parent.id;

    setCommentSubmitting(true);
    try {
      await addDoc(collection(db, 'comments'), {
        marketId: topCard.id,
        marketplaceId: null,
        userId: user.uid,
        username: currentDisplayName || (user.email?.split('@')[0] || 'user'),
        userName: currentDisplayName || (user.email?.split('@')[0] || 'user'),
        text,
        createdAt: new Date(),
        timestamp: new Date(),
        likedBy: [],
        replyTo: rootParentId,
        userSide: topCard.userSide === 'YES' || topCard.userSide === 'NO' ? topCard.userSide : null
      });
      setReplyDraft('');
      setReplyingTo(null);
      await fetchCommentsForMarket(topCard.id);
    } catch (error) {
      console.error('Error posting feed reply:', error);
      setErrorMessage('Unable to post reply right now.');
    } finally {
      setCommentSubmitting(false);
    }
  }, [comments, currentDisplayName, fetchCommentsForMarket, replyDraft, topCard?.id, topCard?.userSide, user]);

  const handleToggleCommentLike = useCallback(async (comment) => {
    if (!user) {
      setErrorMessage('Sign in to like comments.');
      return;
    }
    const uid = user.uid;
    const likedBy = Array.isArray(comment.likedBy) ? comment.likedBy : [];
    const alreadyLiked = likedBy.includes(uid);

    try {
      await updateDoc(doc(db, 'comments', comment.id), {
        likedBy: alreadyLiked ? arrayRemove(uid) : arrayUnion(uid)
      });
      setComments((prev) => prev.map((item) => {
        if (item.id !== comment.id) return item;
        const nextLikedBy = alreadyLiked
          ? likedBy.filter((id) => id !== uid)
          : [...likedBy, uid];
        return { ...item, likedBy: nextLikedBy };
      }));
    } catch (error) {
      console.error('Error toggling comment like:', error);
      setErrorMessage('Unable to update comment like right now.');
    }
  }, [user]);

  const handleDeleteComment = useCallback(async (comment) => {
    if (!user) {
      setErrorMessage('Sign in to delete comments.');
      return;
    }
    if (comment.userId !== user.uid) {
      setErrorMessage('You can only delete your own comments.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'comments', comment.id));
      setComments((prev) => prev.filter((item) => item.id !== comment.id));
      if (replyingTo === comment.id) {
        setReplyingTo(null);
        setReplyDraft('');
      }
    } catch (error) {
      console.error('Error deleting feed comment:', error);
      setErrorMessage('Unable to delete comment right now.');
    }
  }, [replyingTo, user]);

  const handlePointerDown = useCallback((event) => {
    if (!topCard || disableInteractions) return;

    const target = event.target;
    if (target instanceof Element && target.closest('[data-feed-action]')) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({ active: true, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 });
  }, [disableInteractions, topCard]);

  const handlePointerMove = useCallback((event) => {
    if (!dragRef.current.active || disableInteractions) return;

    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;

    setDragState((prev) => ({ ...prev, dx, dy }));
  }, [disableInteractions]);

  const handlePointerUp = useCallback(() => {
    if (!dragRef.current.active || disableInteractions) return;

    const { dx, dy } = dragRef.current;
    setDragState({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });

    if (dx > 80) {
      commitSwipe('right');
      return;
    }
    if (dx < -80) {
      commitSwipe('left');
      return;
    }
    if (dy < -60) {
      commitSwipe('up');
      return;
    }
  }, [commitSwipe, disableInteractions]);

  const currentCard = cards[currentIndex] || null;

  // State values used only by setters (tracked internally)
  void balance;
  void decisions;

  if (loading) {
    return (
      <div className="flex h-[100dvh] overflow-hidden bg-[var(--bg)] items-center justify-center">
        <p className="font-mono text-[0.75rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Loading markets...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-[100dvh] overflow-hidden bg-[var(--bg)] items-center justify-center">
        <p className="font-mono text-[0.75rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Redirecting to login...</p>
      </div>
    );
  }

  const showEmptyState = !showFfInterstitial && (cards.length === 0 || currentIndex >= cards.length);
  const hasMoreCards = currentIndex < cards.length;

  return (
    <div className="h-[100dvh] overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <main className="mx-auto flex h-full w-full max-w-[460px] flex-col px-4 pt-4 md:max-w-[520px] md:px-6 md:pt-6" style={{ paddingBottom: 'calc(56px + var(--safe-bottom, 0px) + 8px)' }}>
        {!showEmptyState && !showFfInterstitial && (
          <div className="queue-label mb-4 text-center font-mono text-[0.48rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="section-tag inline-flex items-center gap-[5px] rounded-[3px] border border-[var(--border)] bg-[var(--surface)] px-2 py-[2px]">
              <span className="section-dot h-[5px] w-[5px] rounded-full" style={{ background: currentCard?.sectionColor || 'var(--text-muted)' }} />
              <span>{currentCard?.section || 'New markets'}</span>
            </span>
          </div>
        )}

        <div className="card-container relative flex-1">
          {errorMessage && !showEmptyState && (
            <div className="mb-3 rounded-[6px] border border-[var(--red-dim)] bg-[var(--red-glow)] px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--red)]">
              {errorMessage}
            </div>
          )}

          {showFfInterstitial ? (
            <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-8 text-center">
              <div className="mb-3 text-4xl animate-[popIn_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">🎯</div>
              <h2 className="mb-2 font-display text-[1.5rem] italic leading-[1.15] text-[var(--text)]">
                Five Futures complete
              </h2>
              <p className="mb-8 max-w-[300px] text-[0.82rem] leading-[1.5] text-[var(--text-dim)]">
                You&apos;ve weighed in on the featured questions. Check back soon for the next five.
              </p>
              {hasMoreCards ? (
                <button
                  type="button"
                  onClick={() => setShowFfInterstitial(false)}
                  className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--red)] px-8 py-3 font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[var(--red-dim)]"
                >
                  Continue Predicting →
                </button>
              ) : (
                <Link
                  href="/markets"
                  className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--border2)] bg-[var(--surface2)] px-8 py-3 font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface3)] hover:text-[var(--text)]"
                >
                  Browse all markets →
                </Link>
              )}
            </div>
          ) : showEmptyState ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
              <h2 className="font-display text-[1.5rem] italic text-[var(--text)]">You&apos;ve seen all open markets</h2>
              <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Check back soon for new predictions
              </p>
              <Link
                href="/markets"
                className="mt-6 inline-flex items-center rounded-[6px] border border-[var(--border2)] bg-[var(--surface)] px-4 py-2 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]"
              >
                Browse all markets →
              </Link>
            </div>
          ) : (
            cards.slice(currentIndex, currentIndex + 3).reverse().map((card, reverseIdx, visibleSlice) => {
              const index = currentIndex + (visibleSlice.length - 1 - reverseIdx);
              const isTop = index === currentIndex;
              const behindClass = isTop
                ? 'z-[3]'
                : index === currentIndex + 1
                  ? 'z-[2] scale-[0.96] translate-y-[10px] opacity-70'
                  : 'z-[1] scale-[0.92] translate-y-[20px] opacity-40';

              const tone = probabilityTone(card.probability);
              const probabilityPercent = Math.round(card.probability * 100);
              const yesRoi = (1 / Math.max(0.01, card.probability)).toFixed(2);
              const noRoi = (1 / Math.max(0.01, 1 - card.probability)).toFixed(2);
              const yesOpacity = isTop && !animatingOut ? Math.max(0, Math.min(1, dragState.dx / 120)) : 0;
              const noOpacity = isTop && !animatingOut ? Math.max(0, Math.min(1, -dragState.dx / 120)) : 0;
              const skipOpacity = isTop && !animatingOut ? Math.max(0, Math.min(1, -dragState.dy / 90)) : 0;

              const dynamicStyle = isTop
                ? exitDirection === 'right'
                  ? { transform: 'translateX(130%) rotate(12deg)', opacity: 0 }
                  : exitDirection === 'left'
                    ? { transform: 'translateX(-130%) rotate(-12deg)', opacity: 0 }
                    : exitDirection === 'up'
                      ? { transform: 'translateY(-110%) scale(0.88)', opacity: 0 }
                      : dragState.active
                        ? { transform: `translate(${dragState.dx}px, ${Math.min(dragState.dy, 0)}px) rotate(${dragState.dx * 0.08}deg)` }
                        : {}
                : {};

              const cardStyle = isTop
                ? {
                  ...dynamicStyle,
                  touchAction: 'none',
                  pointerEvents: disableInteractions ? 'none' : 'auto'
                }
                : dynamicStyle;

              const gradientId = `feed-spark-${card.id}`;

              return (
                <article
                  key={card.id}
                  className={`market-card absolute inset-0 flex flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)] transition-all duration-[450ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${behindClass}`}
                  onPointerDown={isTop ? handlePointerDown : undefined}
                  onPointerMove={isTop ? handlePointerMove : undefined}
                  onPointerUp={isTop ? handlePointerUp : undefined}
                  onPointerCancel={isTop ? handlePointerUp : undefined}
                  style={cardStyle}
                >
                  <div
                    className="swipe-overlay no pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[12px] border-[2.5px] border-[var(--red)] bg-[rgba(220,38,38,0.06)]"
                    style={{ opacity: noOpacity }}
                  >
                    <span className="swipe-label no rounded-[6px] px-[18px] py-[6px] font-mono text-[1.3rem] font-bold uppercase tracking-[0.06em] text-[var(--red)]">← NO</span>
                  </div>
                  <div
                    className="swipe-overlay yes pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[12px] border-[2.5px] border-[var(--green-bright)] bg-[rgba(74,222,128,0.06)]"
                    style={{ opacity: yesOpacity }}
                  >
                    <span className="swipe-label yes rounded-[6px] px-[18px] py-[6px] font-mono text-[1.3rem] font-bold uppercase tracking-[0.06em] text-[var(--green-bright)]">YES →</span>
                  </div>
                  <div
                    className="swipe-overlay skip-up pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-[12px] border-[2.5px] border-[var(--text-muted)] bg-[rgba(90,85,80,0.08)] pt-7"
                    style={{ opacity: skipOpacity }}
                  >
                    <span className="swipe-label skip rounded-[6px] px-[18px] py-[6px] font-mono text-[1.1rem] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">SKIP ↑</span>
                  </div>

                  <div className="card-header flex items-center justify-between px-4 pt-[14px]">
                    <span className="category-pill rounded-[3px] border border-[var(--border2)] bg-[var(--surface3)] px-[8px] py-[2px] font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {card.category}
                    </span>
                    <span className="resolves-tag font-mono text-[0.5rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                      {card.resolvesLabel}
                    </span>
                  </div>

                  <h2 className="card-question px-4 pb-2 pt-3" style={{ fontFamily: 'var(--font-display)' }}>
                    <Link
                      href={`/market/${card.id}`}
                      data-feed-action="view"
                      className="text-[1.25rem] italic leading-[1.35] text-[var(--text)] hover:text-[var(--red)] transition-colors"
                    >
                      {card.question}
                    </Link>
                  </h2>

                  <div className="card-chart h-[52px] px-4">
                    <Sparkline probabilities={card.sparkline} strokeColor={tone.stroke} gradientId={gradientId} />
                  </div>

                  <div className="card-prob flex items-center gap-[10px] px-4 pb-3 pt-2">
                    <span className={`prob-big min-w-[76px] font-mono text-[2rem] font-bold leading-none tracking-[-0.04em] ${tone.textClass}`}>
                      {probabilityPercent}%
                    </span>
                    <div className="prob-right flex flex-1 flex-col gap-[5px]">
                      <div className="prob-bar-bg h-[4px] overflow-hidden rounded-full bg-[var(--surface3)]">
                        <div className={`prob-bar-fill h-full rounded-full ${tone.barClass}`} style={{ width: `${probabilityPercent}%` }} />
                      </div>
                      <div className="prob-meta flex gap-3 font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        <span>YES</span>
                        <span>Vol <strong className="font-normal text-[var(--text-dim)]">${Math.round(card.totalVolume).toLocaleString()}</strong></span>
                        <span>Traders <strong className="font-normal text-[var(--text-dim)]">{Math.round(card.traders)}</strong></span>
                      </div>
                    </div>
                  </div>

                  {card.priceMovedSinceEntry && (
                    <div className="price-alert mx-4 mb-2 flex items-center gap-[6px] rounded-[4px] border border-[rgba(251,191,36,0.2)] bg-[rgba(251,191,36,0.05)] px-[10px] py-[6px] font-mono text-[0.52rem] uppercase tracking-[0.08em] text-[var(--amber-bright)]">
                      <span>⚠</span>
                      <span>Price moved {card.priceMovePoints >= 0 ? '+' : ''}{card.priceMovePoints}pts since you traded</span>
                    </div>
                  )}

                  {card.userPosition && (
                    <div className="position-banner mx-4 mb-[10px] flex items-center gap-2 rounded-[5px] border border-[var(--red-dim)] bg-[var(--red-glow)] px-3 py-2">
                      <div className="pos-left flex min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="pos-label font-mono text-[0.48rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Your position</span>
                        <span className="pos-detail font-mono text-[0.7rem] text-[var(--text)]">
                          ${card.userCostBasis.toFixed(2)} · {card.userSide || 'MIXED'} · {formatEntryDate(card.entryDate)}
                        </span>
                      </div>
                      <div className={`pos-pnl shrink-0 text-right font-mono text-[0.78rem] font-bold ${card.unrealizedPnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                        {card.unrealizedPnl >= 0 ? '+' : '-'}${Math.abs(card.unrealizedPnl).toFixed(2)}
                        <small className="block font-mono text-[0.46rem] font-normal uppercase tracking-[0.08em] text-[var(--text-muted)]">Unrealized</small>
                      </div>
                      {(card.userSide === 'YES' || card.userSide === 'NO') && (
                        <button
                          type="button"
                          data-feed-action="sell"
                          onClick={() => handleSell(card)}
                          disabled={sellingMarketId === card.id || disableInteractions}
                          className="shrink-0 rounded-[4px] border border-[var(--red-dim)] bg-[rgba(220,38,38,0.18)] px-[10px] py-[6px] font-mono text-[0.52rem] uppercase tracking-[0.08em] text-[var(--red)] transition-colors hover:bg-[rgba(220,38,38,0.32)] disabled:opacity-50"
                        >
                          {sellingMarketId === card.id ? '…' : 'Sell'}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="card-divider border-t border-[var(--border)]" />

                  <div className="card-actions grid grid-cols-3">
                    <button
                      type="button"
                      data-feed-action="no"
                      onClick={() => commitSwipe('left')}
                      disabled={disableInteractions}
                      className="action-btn no flex min-h-[56px] flex-col items-center justify-center gap-[3px] border-r border-[var(--border)] transition-colors hover:bg-[var(--surface3)] disabled:opacity-50"
                    >
                      <span className="label font-mono text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[var(--red)]">No</span>
                      <span className="roi font-mono text-[0.52rem] text-[var(--text-muted)]">{noRoi}x</span>
                    </button>
                    <button
                      type="button"
                      data-feed-action="skip"
                      onClick={() => commitSwipe('up')}
                      disabled={disableInteractions}
                      className="action-btn skip flex min-h-[56px] flex-col items-center justify-center gap-[5px] transition-colors hover:bg-[var(--surface3)] disabled:opacity-50"
                    >
                      <span className="icon text-[1.3rem] leading-none text-[var(--text-muted)]">↑</span>
                      <span className="label font-mono text-[0.46rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Skip</span>
                    </button>
                    <button
                      type="button"
                      data-feed-action="yes"
                      onClick={() => commitSwipe('right')}
                      disabled={disableInteractions}
                      className="action-btn yes flex min-h-[56px] flex-col items-center justify-center gap-[3px] border-l border-[var(--border)] transition-colors hover:bg-[var(--surface3)] disabled:opacity-50"
                    >
                      <span className="label font-mono text-[0.72rem] font-bold uppercase tracking-[0.06em] text-[var(--green-bright)]">Yes</span>
                      <span className="roi font-mono text-[0.52rem] text-[var(--text-muted)]">{yesRoi}x</span>
                    </button>
                  </div>

                  {isTop && (
                    <div
                      className="flex-1 overflow-y-auto border-t border-[var(--border)]"
                      style={{ minHeight: 0 }}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="sticky top-0 z-[2] flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
                        <p className="font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                          Comments ({normalizedComments.length})
                        </p>
                        <Link
                          href={`/market/${card.id}`}
                          data-feed-action="full-discussion"
                          className="font-mono text-[0.52rem] uppercase tracking-[0.08em] text-[var(--red)] hover:text-[var(--red-dim)]"
                        >
                          Full thread →
                        </Link>
                      </div>

                      {user ? (
                        <div className="border-b border-[var(--border)] px-4 py-3">
                          <div className="flex items-start gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--red-dim)] bg-[var(--red-glow)] font-mono text-[0.55rem] font-bold text-[var(--red)]">
                              {getInitials(currentDisplayName)}
                            </div>
                            <textarea
                              value={commentDraft}
                              onChange={(e) => setCommentDraft(e.target.value)}
                              placeholder="Add your take..."
                              autoComplete="off"
                              maxLength={400}
                              data-feed-action="comment-input"
                              className="min-h-[48px] w-full resize-none rounded-[5px] border border-[var(--border2)] bg-[var(--surface2)] px-2 py-2 text-[0.78rem] text-[var(--text)]"
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="font-mono text-[0.48rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                              posting as {currentDisplayName}
                            </span>
                            <button
                              type="button"
                              data-feed-action="post-comment"
                              onClick={handlePostComment}
                              disabled={!commentDraft.trim() || commentSubmitting}
                              className="rounded-[4px] bg-[var(--red)] px-3 py-[6px] font-mono text-[0.54rem] uppercase tracking-[0.08em] text-white transition-colors hover:bg-[var(--red-dim)] disabled:opacity-50"
                            >
                              {commentSubmitting ? 'Posting…' : 'Post'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="border-b border-[var(--border)] px-4 py-3 text-center">
                          <Link
                            href={`/login?next=${encodeURIComponent('/feed')}`}
                            data-feed-action="login-comment"
                            className="font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--red)] hover:text-[var(--red-dim)]"
                          >
                            Sign in to comment
                          </Link>
                        </div>
                      )}

                      {commentsLoading ? (
                        <div className="flex flex-col gap-2 px-4 py-3">
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="h-3 animate-pulse rounded bg-[var(--surface3)]" style={{ width: `${60 + i * 10}%` }} />
                          ))}
                        </div>
                      ) : rootComments.length === 0 ? (
                        <p className="px-4 py-5 text-center font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                          No comments yet
                        </p>
                      ) : (
                        <div className="divide-y divide-[var(--border)]">
                          {rootComments.map((comment) => {
                            const replies = (repliesByParent[comment.id] || [])
                              .sort((a, b) => toMillis(a.timestamp || a.createdAt) - toMillis(b.timestamp || b.createdAt));
                            const likedBy = Array.isArray(comment.likedBy) ? comment.likedBy : [];
                            const liked = !!user && likedBy.includes(user.uid);

                            return (
                              <div key={comment.id} className="px-4 py-3">
                                <div className="flex gap-2">
                                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border2)] bg-[var(--surface3)] font-mono text-[0.52rem] font-bold text-[var(--text-dim)]">
                                    {getInitials(getCommentDisplayName(comment))}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate text-[0.73rem] font-semibold text-[var(--text)]">{getCommentDisplayName(comment)}</span>
                                      <span className="font-mono text-[0.48rem] uppercase tracking-[0.07em] text-[var(--text-muted)]">
                                        {formatCommentTime(comment.timestamp || comment.createdAt)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-[0.76rem] leading-[1.45] text-[var(--text-dim)] whitespace-pre-wrap">
                                      {comment.text}
                                    </p>
                                    <div className="mt-2 flex items-center gap-3">
                                      <button
                                        type="button"
                                        data-feed-action="like-comment"
                                        onClick={() => handleToggleCommentLike(comment)}
                                        className={`font-mono text-[0.52rem] uppercase tracking-[0.07em] transition-colors ${
                                          liked ? 'text-[var(--red)]' : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
                                        }`}
                                      >
                                        ♥ {likedBy.length}
                                      </button>
                                      <button
                                        type="button"
                                        data-feed-action="reply-comment"
                                        onClick={() => {
                                          if (!user) {
                                            setErrorMessage('Sign in to reply.');
                                            return;
                                          }
                                          setReplyingTo(comment.id);
                                          setReplyDraft('');
                                        }}
                                        className="font-mono text-[0.52rem] uppercase tracking-[0.07em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-dim)]"
                                      >
                                        Reply
                                      </button>
                                      {user?.uid === comment.userId && (
                                        <button
                                          type="button"
                                          data-feed-action="delete-comment"
                                          onClick={() => handleDeleteComment(comment)}
                                          className="font-mono text-[0.52rem] uppercase tracking-[0.07em] text-[var(--red)] transition-colors hover:text-[var(--red-dim)]"
                                        >
                                          Delete
                                        </button>
                                      )}
                                    </div>

                                    {replyingTo === comment.id && (
                                      <div className="mt-2 border-l border-[var(--border)] pl-3">
                                        <textarea
                                          value={replyDraft}
                                          onChange={(e) => setReplyDraft(e.target.value)}
                                          placeholder={`Reply to ${getCommentDisplayName(comment)}...`}
                                          autoComplete="off"
                                          maxLength={400}
                                          data-feed-action="reply-input"
                                          className="min-h-[44px] w-full resize-none rounded-[5px] border border-[var(--border2)] bg-[var(--surface2)] px-2 py-2 text-[0.74rem] text-[var(--text)]"
                                        />
                                        <div className="mt-2 flex justify-end gap-2">
                                          <button
                                            type="button"
                                            data-feed-action="cancel-reply"
                                            onClick={() => {
                                              setReplyingTo(null);
                                              setReplyDraft('');
                                            }}
                                            className="font-mono text-[0.5rem] uppercase tracking-[0.07em] text-[var(--text-muted)] hover:text-[var(--text-dim)]"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            data-feed-action="post-reply"
                                            onClick={() => handlePostReply(comment.id)}
                                            disabled={!replyDraft.trim() || commentSubmitting}
                                            className="rounded-[4px] bg-[var(--red)] px-3 py-[5px] font-mono text-[0.5rem] uppercase tracking-[0.07em] text-white transition-colors hover:bg-[var(--red-dim)] disabled:opacity-50"
                                          >
                                            {commentSubmitting ? 'Posting…' : 'Reply'}
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {replies.length > 0 && (
                                      <div className="mt-3 space-y-2 border-l border-[var(--border)] pl-3">
                                        {replies.map((reply) => {
                                          const replyLikedBy = Array.isArray(reply.likedBy) ? reply.likedBy : [];
                                          const replyLiked = !!user && replyLikedBy.includes(user.uid);
                                          return (
                                            <div key={reply.id} className="rounded-[5px] border border-[var(--border)] bg-[var(--surface2)] px-2 py-2">
                                              <div className="flex items-center gap-2">
                                                <span className="text-[0.68rem] font-semibold text-[var(--text)]">{getCommentDisplayName(reply)}</span>
                                                <span className="font-mono text-[0.46rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                                                  {formatCommentTime(reply.timestamp || reply.createdAt)}
                                                </span>
                                              </div>
                                              <p className="mt-1 text-[0.72rem] leading-[1.4] text-[var(--text-dim)] whitespace-pre-wrap">
                                                {reply.text}
                                              </p>
                                              <button
                                                type="button"
                                                data-feed-action="like-reply"
                                                onClick={() => handleToggleCommentLike(reply)}
                                                className={`mt-1 font-mono text-[0.48rem] uppercase tracking-[0.06em] transition-colors ${
                                                  replyLiked ? 'text-[var(--red)]' : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
                                                }`}
                                              >
                                                ♥ {replyLikedBy.length}
                                              </button>
                                              {user?.uid === reply.userId && (
                                                <button
                                                  type="button"
                                                  data-feed-action="delete-reply"
                                                  onClick={() => handleDeleteComment(reply)}
                                                  className="ml-3 mt-1 font-mono text-[0.48rem] uppercase tracking-[0.06em] text-[var(--red)] transition-colors hover:text-[var(--red-dim)]"
                                                >
                                                  Delete
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {!showEmptyState && !showFfInterstitial && (
          <div className="swipe-hints flex items-center justify-center gap-[18px] py-[8px]">
            <span className="hint inline-flex items-center gap-[5px] font-mono text-[0.46rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <span className="hint-dot no h-[5px] w-[5px] rounded-full bg-[var(--red)]" />
              ← Bet No
            </span>
            <span className="hint inline-flex items-center gap-[5px] font-mono text-[0.46rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <span className="hint-dot skip h-[5px] w-[5px] rounded-full bg-[var(--text-muted)]" />
              ↑ Skip
            </span>
            <span className="hint inline-flex items-center gap-[5px] font-mono text-[0.46rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Bet Yes →
              <span className="hint-dot yes h-[5px] w-[5px] rounded-full bg-[var(--green-bright)]" />
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
