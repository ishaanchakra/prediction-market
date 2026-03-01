'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth, db, functions } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { MARKET_STATUS } from '@/utils/marketStatus';

const DEFAULT_BET_AMOUNT = 25; // $25 per quick-take bet
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

function ActivityRow({ item }) {
  if (item.type === 'comment') {
    return (
      <div className="flex gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="mt-0.5 shrink-0 font-mono text-[0.6rem] text-[var(--text-muted)]">💬</span>
        <div className="min-w-0">
          <p className="mb-0.5 font-mono text-[0.5rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
            {item.author}
          </p>
          <p className="truncate font-sans text-[0.72rem] leading-snug text-[var(--text)]">
            {item.text}
          </p>
        </div>
      </div>
    );
  }

  if (item.type === 'news') {
    return (
      <div className="flex gap-2 border-b border-[var(--border)] bg-[rgba(220,38,38,0.04)] px-4 py-2">
        <span className="mt-0.5 shrink-0 font-mono text-[0.6rem] text-[var(--red)]">◈</span>
        <p className="min-w-0 font-sans text-[0.72rem] leading-snug text-[var(--text)]">
          {item.text}
        </p>
      </div>
    );
  }

  if (item.type === 'trade') {
    const isYes = item.side === 'YES';
    const color = isYes ? 'var(--green-bright)' : 'var(--red)';
    const fromPct = Math.round((item.from || 0) * 100);
    const toPct = Math.round((item.to || 0) * 100);
    const arrow = toPct > fromPct ? '↑' : '↓';
    return (
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
        <span className="shrink-0 font-mono text-[0.6rem]" style={{ color }}>{arrow}</span>
        <p className="font-mono text-[0.6rem] text-[var(--text-dim)]">
          <span style={{ color }}>{item.side}</span>
          {' '}{fromPct}% → {toPct}%
          {item.amount ? (
            <span className="text-[var(--text-muted)]"> · ${Math.round(item.amount)}</span>
          ) : null}
        </p>
      </div>
    );
  }

  return null;
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
  const [activityItems, setActivityItems] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [sellingMarketId, setSellingMarketId] = useState(null);

  const topCard = cards[currentIndex] || null;
  const hasCardsRemaining = currentIndex < cards.length;
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

  useEffect(() => {
    if (!topCard) {
      setActivityItems([]);
      setActivityLoading(false);
      return;
    }

    let cancelled = false;
    setActivityLoading(true);
    setActivityItems([]);

    (async () => {
      try {
        const [commentsResult, newsResult, betsResult] = await Promise.allSettled([
          getDocs(
            query(
              collection(db, 'comments'),
              where('marketId', '==', topCard.id),
              where('marketplaceId', '==', null),
              orderBy('createdAt', 'desc'),
              limit(10)
            )
          ),
          getDocs(
            query(
              collection(db, 'newsItems'),
              where('marketId', '==', topCard.id),
              where('marketplaceId', '==', null),
              orderBy('timestamp', 'desc'),
              limit(10)
            )
          ),
          getDocs(
            query(
              collection(db, 'bets'),
              where('marketId', '==', topCard.id),
              where('marketplaceId', '==', null),
              orderBy('timestamp', 'desc'),
              limit(30)
            )
          )
        ]);

        if (cancelled) return;

        const comments = commentsResult.status === 'fulfilled'
          ? commentsResult.value.docs.map((d) => {
            const data = d.data();
            return { type: 'comment', text: data.text, author: data.displayName || 'anon', ts: data.createdAt?.toMillis?.() || 0 };
          })
          : [];

        const news = newsResult.status === 'fulfilled'
          ? newsResult.value.docs.map((d) => {
            const data = d.data();
            return { type: 'news', text: data.headline || data.title || data.text, ts: data.timestamp?.toMillis?.() || 0 };
          })
          : [];

        const trades = betsResult.status === 'fulfilled'
          ? betsResult.value.docs
            .map((d) => {
              const data = d.data();
              return { type: 'trade', side: data.side, from: data.previousProbability, to: data.newProbability, amount: data.amount, ts: data.timestamp?.toMillis?.() || 0 };
            })
            .filter((t) => Math.abs((t.to || 0) - (t.from || 0)) >= 0.03)
          : [];

        const merged = [...comments, ...news, ...trades]
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 15);

        if (!cancelled) setActivityItems(merged);
      } catch {
        if (!cancelled) setActivityItems([]);
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [topCard?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFeedCards = useCallback(async (currentUser) => {
    const marketsSnap = await getDocs(
      query(
        collection(db, 'markets'),
        where('resolution', '==', null),
        where('marketplaceId', '==', null),
        limit(MAX_MARKETS)
      )
    );

    const markets = marketsSnap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
      .filter((market) => market.status === MARKET_STATUS.OPEN);

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

      const section = !hasPosition
        ? 'New markets'
        : priceMovedSinceEntry
          ? 'Your positions · moved'
          : 'Your positions · stable';

      const sectionColor = !hasPosition
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
        sectionColor
      };
    });

    const newMarkets = baseCards.filter((card) => !card.userPosition);
    const movedPositions = baseCards.filter((card) => card.userPosition && card.priceMovedSinceEntry);
    const stablePositions = baseCards.filter((card) => card.userPosition && !card.priceMovedSinceEntry);

    return [...newMarkets, ...movedPositions, ...stablePositions];
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
        router.push('/login?next=%2Ffeed');
        return;
      }

      unsubscribeBalance = onSnapshot(
        doc(db, 'users', currentUser.uid),
        (userDoc) => {
          if (userDoc.exists()) {
            setBalance(Number(userDoc.data()?.weeklyRep || 0));
          } else {
            setBalance(0);
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

      setCurrentIndex((prev) => prev + 1);
      setDragState({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });
      setExitDirection(null);
      setAnimatingOut(false);
      setSubmitting(false);
    }, CARD_EXIT_MS);
  }, [currentIndex, topCard]);

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

  function dotClass(index) {
    if (index === currentIndex && hasCardsRemaining) {
      return 'scale-110 border-[var(--red)] bg-[var(--red)]';
    }

    if (index < currentIndex) {
      const decision = decisions[index];
      if (decision === 'YES') return 'border-[var(--green-bright)] bg-[var(--green-bright)]';
      if (decision === 'NO') return 'border-[var(--red-dim)] bg-[var(--red-dim)]';
      return 'border-[var(--text-muted)] bg-[var(--text-muted)]';
    }

    return 'border-[var(--border2)] bg-transparent';
  }

  // Balance listener is required for this page, but balance is intentionally not displayed in this layout.
  void balance;

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

  const showEmptyState = cards.length === 0 || currentIndex >= cards.length;

  return (
    <div className="h-[100dvh] overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <main className="mx-auto flex h-full w-full max-w-[460px] flex-col px-4 pt-4 md:max-w-[520px] md:px-6 md:pt-6" style={{ paddingBottom: 'calc(56px + var(--safe-bottom, 0px) + 8px)' }}>
        {!showEmptyState && (
          <>
            <div className="queue-label mb-4 text-center font-mono text-[0.48rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <span className="section-tag inline-flex items-center gap-[5px] rounded-[3px] border border-[var(--border)] bg-[var(--surface)] px-2 py-[2px]">
                <span className="section-dot h-[5px] w-[5px] rounded-full" style={{ background: currentCard?.sectionColor || 'var(--text-muted)' }} />
                <span>{currentCard?.section || 'New markets'}</span>
              </span>
            </div>
          </>
        )}

        <div className="card-container relative flex-1">
          {errorMessage && !showEmptyState && (
            <div className="mb-3 rounded-[6px] border border-[var(--red-dim)] bg-[var(--red-glow)] px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--red)]">
              {errorMessage}
            </div>
          )}

          {showEmptyState ? (
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
              const yesOpacity = isTop ? Math.max(0, Math.min(1, dragState.dx / 120)) : 0;
              const noOpacity = isTop ? Math.max(0, Math.min(1, -dragState.dx / 120)) : 0;
              const skipOpacity = isTop ? Math.max(0, Math.min(1, -dragState.dy / 90)) : 0;

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
                      {activityLoading ? (
                        <div className="flex flex-col gap-2 px-4 py-3">
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="h-3 animate-pulse rounded bg-[var(--surface3)]" style={{ width: `${60 + i * 10}%` }} />
                          ))}
                        </div>
                      ) : activityItems.length === 0 ? (
                        <p className="px-4 py-5 text-center font-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                          No activity yet
                        </p>
                      ) : (
                        <div className="flex flex-col">
                          {activityItems.map((item, i) => (
                            <ActivityRow key={i} item={item} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        {!showEmptyState && (
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
