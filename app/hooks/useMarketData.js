'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getPublicDisplayName } from '@/utils/displayName';
import { toMarketplaceMemberId } from '@/utils/marketplace';
import { getMarketStatus } from '@/utils/marketStatus';
import { round2, round8 } from '@/utils/round';

function toMillis(value) {
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value);
  const ts = parsed.getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

export function useMarketData(marketId, currentUser) {
  const [serverData, setServerData] = useState({
    market: null,
    membership: null,
    betHistory: [],
    userPosition: { yesShares: 0, noShares: 0, yesInvested: 0, noInvested: 0 },
    recentTrades: [],
    comments: [],
    newsItems: [],
    topBettors: [],
    relatedMarkets: [],
    marketStats: { totalTraded: 0, bettors: 0 },
    loading: true,
    error: null
  });

  const [optimisticTrade, setOptimisticTrade] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const refresh = useCallback(() => {
    setOptimisticTrade(null); // Clear optimistic on manual or post-trade refresh
    setRefreshTrigger(prev => prev + 1);
  }, []);

  const applyOptimisticTrade = useCallback((trade) => {
    // trade: { side, amount, shares, newProbability, newPool, type: 'BUY' | 'SELL' }
    setOptimisticTrade(trade);
  }, []);

  const rollbackOptimisticTrade = useCallback(() => {
    setOptimisticTrade(null);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      if (!marketId) return;

      try {
        const marketRef = doc(db, 'markets', marketId);
        const marketSnap = await getDoc(marketRef);
        
        if (!marketSnap.exists()) {
          if (isMounted) setServerData(prev => ({ ...prev, loading: false, error: 'Market not found' }));
          return;
        }

        const market = { id: marketSnap.id, ...marketSnap.data() };
        const marketScopeId = market.marketplaceId || null;

        let membership = null;
        if (marketScopeId) {
          if (!currentUser) {
            if (isMounted) setServerData(prev => ({ ...prev, market, loading: false, error: 'AUTH_REQUIRED' }));
            return;
          }
          const memberSnap = await getDoc(
            doc(db, 'marketplaceMembers', toMarketplaceMemberId(marketScopeId, currentUser.uid))
          );
          if (!memberSnap.exists()) {
            if (isMounted) setServerData(prev => ({ ...prev, market, loading: false, error: 'MEMBERSHIP_REQUIRED' }));
            return;
          }
          membership = { id: memberSnap.id, ...memberSnap.data() };
        }

        const [
          betsSnap,
          recentTradesSnap,
          commentsSnap,
          newsItemsSnap,
          relatedSnap
        ] = await Promise.all([
          getDocs(query(
            collection(db, 'bets'),
            where('marketId', '==', marketId),
            where('marketplaceId', '==', marketScopeId),
            orderBy('timestamp', 'desc'),
            limit(500)
          )),
          getDocs(query(
            collection(db, 'bets'),
            where('marketId', '==', marketId),
            where('marketplaceId', '==', marketScopeId),
            orderBy('timestamp', 'desc'),
            limit(15)
          )),
          getDocs(query(
            collection(db, 'comments'),
            where('marketId', '==', marketId),
            where('marketplaceId', '==', marketScopeId),
            limit(200)
          )),
          getDocs(query(
            collection(db, 'newsItems'),
            where('marketId', '==', marketId),
            where('marketplaceId', '==', marketScopeId),
            limit(100)
          )),
          getDocs(marketScopeId 
            ? query(collection(db, 'markets'), where('marketplaceId', '==', marketScopeId), orderBy('createdAt', 'desc'), limit(18))
            : query(collection(db, 'markets'), where('marketplaceId', '==', null), orderBy('createdAt', 'desc'), limit(18))
          )
        ]);

        if (!isMounted) return;

        const trades = betsSnap.docs.map(d => d.data()).reverse();
        const totalTraded = trades.reduce((sum, t) => sum + Math.abs(Number(t.amount || 0)), 0);
        const uniqueBettors = new Set(trades.map(t => t.userId)).size;
        
        const seededProbability = typeof market.initialProbability === 'number' ? market.initialProbability : 0.5;
        const chartData = [
          { timestamp: market.createdAt?.toDate?.().getTime() || Date.now(), probability: seededProbability },
          ...trades.map(t => ({ timestamp: t.timestamp?.toDate?.().getTime() || Date.now(), probability: t.probability }))
        ];
        if (typeof market.probability === 'number') {
          chartData.push({ timestamp: Date.now(), probability: market.probability });
        }

        let userPos = { yesShares: 0, noShares: 0, yesInvested: 0, noInvested: 0 };
        if (currentUser) {
          const userBets = betsSnap.docs.filter(d => d.data().userId === currentUser.uid).map(d => d.data());
          userBets.forEach(bet => {
            const shares = Number(bet.shares || 0);
            const amount = Number(bet.amount || 0);
            if (bet.side === 'YES') {
              userPos.yesShares += (bet.type === 'SELL' ? -Math.abs(shares) : shares);
              userPos.yesInvested += (bet.type === 'SELL' ? -Math.abs(amount) : amount);
            } else {
              userPos.noShares += (bet.type === 'SELL' ? -Math.abs(shares) : shares);
              userPos.noInvested += (bet.type === 'SELL' ? -Math.abs(amount) : amount);
            }
          });
          const clean = v => (Math.abs(v) < 0.001 ? 0 : v);
          userPos = {
            yesShares: clean(userPos.yesShares),
            noShares: clean(userPos.noShares),
            yesInvested: clean(userPos.yesInvested),
            noInvested: clean(userPos.noInvested)
          };
        }

        const processedRecentTrades = await Promise.all(recentTradesSnap.docs.map(async (d) => {
          const bet = d.data();
          const uDoc = await getDoc(doc(db, 'users', bet.userId));
          return { id: d.id, ...bet, userName: getPublicDisplayName({ id: bet.userId, ...uDoc.data() }) };
        }));

        const positionMap = new Map();
        betsSnap.docs.forEach(d => {
          const bet = d.data();
          if (!bet.userId) return;
          const entry = positionMap.get(bet.userId) || { userId: bet.userId, yesShares: 0, noShares: 0, invested: 0 };
          const shares = Number(bet.shares || 0);
          const amount = Number(bet.amount || 0);
          if (bet.type === 'SELL') {
            if (bet.side === 'YES') entry.yesShares -= Math.abs(shares);
            else entry.noShares -= Math.abs(shares);
            entry.invested -= Math.abs(amount);
          } else {
            if (bet.side === 'YES') entry.yesShares += shares;
            else entry.noShares += shares;
            entry.invested += amount;
          }
          positionMap.set(bet.userId, entry);
        });

        const topBettorsRaw = Array.from(positionMap.values())
          .filter(e => Math.max(e.yesShares, e.noShares) > 0.001)
          .sort((a, b) => b.invested - a.invested)
          .slice(0, 5);

        const topBettors = await Promise.all(topBettorsRaw.map(async (e) => {
          const uDoc = await getDoc(doc(db, 'users', e.userId));
          return {
            ...e,
            name: getPublicDisplayName({ id: e.userId, ...uDoc.data() }),
            dominantSide: e.yesShares >= e.noShares ? 'YES' : 'NO',
            dominantShares: Math.max(e.yesShares, e.noShares)
          };
        }));

        const relatedMarkets = relatedSnap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(m => m.id !== marketId && m.resolution == null && getMarketStatus(m) !== 'CANCELLED')
          .slice(0, 3);

        setServerData({
          market,
          membership,
          betHistory: chartData,
          userPosition: userPos,
          recentTrades: processedRecentTrades,
          comments: commentsSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.timestamp || b.createdAt) - toMillis(a.timestamp || a.createdAt)),
          newsItems: newsItemsSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => toMillis(b.timestamp || b.createdAt) - toMillis(a.timestamp || a.createdAt)),
          topBettors,
          relatedMarkets,
          marketStats: { totalTraded, bettors: uniqueBettors },
          loading: false,
          error: null
        });

      } catch (err) {
        console.error('Error fetching consolidated market data:', err);
        if (isMounted) {
          setServerData(prev => ({ ...prev, loading: false, error: 'Unable to load market data' }));
        }
      }
    }

    fetchData();
    return () => { isMounted = false; };
  }, [marketId, currentUser, refreshTrigger]);

  const effectiveData = useMemo(() => {
    if (!optimisticTrade || !serverData.market) return serverData;

    const { side, amount, shares, newProbability, newPool, type } = optimisticTrade;
    
    const market = {
      ...serverData.market,
      probability: newProbability,
      outstandingShares: newPool,
      totalVolume: (serverData.market.totalVolume || 0) + Math.abs(amount)
    };

    const betHistory = [
      ...serverData.betHistory,
      { timestamp: Date.now(), probability: newProbability, isOptimistic: true }
    ];

    const userPosition = { ...serverData.userPosition };
    if (type === 'BUY') {
      if (side === 'YES') {
        userPosition.yesShares = round8(userPosition.yesShares + shares);
        userPosition.yesInvested = round2(userPosition.yesInvested + amount);
      } else {
        userPosition.noShares = round8(userPosition.noShares + shares);
        userPosition.noInvested = round2(userPosition.noInvested + amount);
      }
    } else { // SELL
      if (side === 'YES') {
        userPosition.yesShares = round8(userPosition.yesShares - shares);
        userPosition.yesInvested = round2(userPosition.yesInvested - Math.abs(amount)); // amount is negative in payout result usually but here we adjust invested
      } else {
        userPosition.noShares = round8(userPosition.noShares - shares);
        userPosition.noInvested = round2(userPosition.noInvested - Math.abs(amount));
      }
    }

    let membership = serverData.membership;
    if (membership) {
      membership = {
        ...membership,
        balance: type === 'BUY' ? round2(membership.balance - amount) : round2(membership.balance + Math.abs(amount))
      };
    }

    return {
      ...serverData,
      market,
      betHistory,
      userPosition,
      membership,
      marketStats: {
        ...serverData.marketStats,
        totalTraded: serverData.marketStats.totalTraded + Math.abs(amount)
      }
    };
  }, [serverData, optimisticTrade]);

  return { ...effectiveData, applyOptimisticTrade, rollbackOptimisticTrade, refresh };
}
