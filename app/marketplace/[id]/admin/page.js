'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import { calculateRefundsByUser, round2 } from '@/utils/refunds';
import { CATEGORIES, categorizeMarket } from '@/utils/categorize';
import {
  MARKETPLACE_RESET_MODE,
  mondayIso,
  nextWeeklyResetDate,
  toMarketplaceMemberId
} from '@/utils/marketplace';
import { calculateMarketplacePortfolioRows } from '@/utils/marketplacePortfolio';
import { fetchMarketplaceContext, fetchMarketplaceMarkets } from '@/utils/marketplaceClient';
import { getPublicDisplayName } from '@/utils/displayName';
import { categoryForNotificationType } from '@/utils/notificationCategories';

const INPUT_CLASS =
  'w-full rounded border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 font-mono text-[0.78rem] text-[var(--text)] focus:outline-none focus:border-[var(--red)]';
const BTN_BASE =
  'rounded border px-3 py-2 font-mono text-[0.62rem] uppercase tracking-[0.08em] transition-colors disabled:opacity-60';

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function toDate(value) {
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export default function MarketplaceAdminPage() {
  const params = useParams();
  const router = useRouter();
  const marketplaceId = params?.id;
  const { toasts, notifyError, notifySuccess, confirmToast, removeToast, resolveConfirm } = useToastQueue();

  const [loading, setLoading] = useState(true);
  const [marketplace, setMarketplace] = useState(null);
  const [membership, setMembership] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [members, setMembers] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [processingMarketId, setProcessingMarketId] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [createPending, setCreatePending] = useState(false);

  const [question, setQuestion] = useState('');
  const [resolutionRules, setResolutionRules] = useState('');
  const [initialProbability, setInitialProbability] = useState(50);
  const [bValue, setBValue] = useState(50);
  const [category, setCategory] = useState('wildcard');

  const isCreator = membership?.role === 'CREATOR';

  const activeMarkets = useMemo(
    () => markets.filter((market) => {
      const status = getMarketStatus(market);
      return status === MARKET_STATUS.OPEN || status === MARKET_STATUS.LOCKED;
    }),
    [markets]
  );

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      setLoading(true);
      try {
        const { marketplace: marketplaceDoc, membership: membershipDoc } = await fetchMarketplaceContext(marketplaceId, currentUser.uid);
        if (!marketplaceDoc || marketplaceDoc.isArchived) {
          notifyError('Marketplace not found.');
          router.push('/marketplace/enter');
          return;
        }
        if (!membershipDoc) {
          router.push(`/marketplace/enter?marketplace=${marketplaceId}`);
          return;
        }
        if (membershipDoc.role !== 'CREATOR') {
          notifyError('Creator access only.');
          router.push(`/marketplace/${marketplaceId}`);
          return;
        }

        setMarketplace(marketplaceDoc);
        setMembership(membershipDoc);
        setBValue(Number(marketplaceDoc.defaultB || 50));

        await loadData();
      } catch (error) {
        console.error('Error loading marketplace admin:', error);
        notifyError('Unable to load marketplace admin.');
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceId, router]);

  async function loadData() {
    const [marketRows, membersSnap] = await Promise.all([
      fetchMarketplaceMarkets(marketplaceId),
      getDocs(query(collection(db, 'marketplaceMembers'), where('marketplaceId', '==', marketplaceId)))
    ]);
    setMarkets(marketRows);
    const memberRows = membersSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
    setMembers(memberRows);

    const userIds = [...new Set(memberRows.map((member) => member.userId))];
    const users = await Promise.all(
      userIds.map(async (userId) => {
        const userSnap = await getDoc(doc(db, 'users', userId));
        return [userId, userSnap.exists() ? userSnap.data() : {}];
      })
    );
    setUserMap(Object.fromEntries(users));
  }

  async function logCreatorAction(action, detail) {
    await addDoc(collection(db, 'adminLog'), {
      action,
      detail,
      adminEmail: auth.currentUser?.email || 'unknown',
      marketplaceId,
      timestamp: new Date()
    });
  }

  async function handleCreateMarket(e) {
    e.preventDefault();
    if (!isCreator) return;
    if (!question.trim()) {
      notifyError('Enter a market question.');
      return;
    }
    if (initialProbability < 1 || initialProbability > 99) {
      notifyError('Initial probability must be between 1 and 99.');
      return;
    }

    setCreatePending(true);
    try {
      const probDecimal = Number(initialProbability) / 100;
      const b = Number(bValue || marketplace?.defaultB || 50);
      const qYes = b * Math.log(probDecimal / (1 - probDecimal));
      const normalizedQuestion = question.trim();
      const nextCategory = category === 'auto' ? categorizeMarket(normalizedQuestion) : category;

      await addDoc(collection(db, 'markets'), {
        question: normalizedQuestion,
        resolutionRules: resolutionRules.trim() || null,
        probability: round2(probDecimal),
        initialProbability: round2(probDecimal),
        outstandingShares: { yes: qYes, no: 0 },
        b,
        status: MARKET_STATUS.OPEN,
        resolution: null,
        resolvedAt: null,
        lockedAt: null,
        cancelledAt: null,
        createdAt: new Date(),
        marketplaceId,
        createdBy: membership.userId,
        category: nextCategory
      });

      await logCreatorAction('CREATE', `Marketplace market created: ${normalizedQuestion.slice(0, 120)}`);
      notifySuccess('Marketplace market created.');
      setQuestion('');
      setResolutionRules('');
      setInitialProbability(50);
      setCategory('wildcard');
      await loadData();
    } catch (error) {
      console.error('Error creating marketplace market:', error);
      notifyError('Could not create market.');
    } finally {
      setCreatePending(false);
    }
  }

  async function handleToggleLock(market, nextStatus) {
    setProcessingMarketId(market.id);
    try {
      await updateDoc(doc(db, 'markets', market.id), {
        status: nextStatus,
        lockedAt: nextStatus === MARKET_STATUS.LOCKED ? new Date() : null
      });
      await logCreatorAction('EDIT', `Marketplace market ${nextStatus === MARKET_STATUS.LOCKED ? 'locked' : 'unlocked'}: ${market.question}`);
      await loadData();
    } catch (error) {
      console.error('Error toggling lock:', error);
      notifyError('Could not update lock state.');
    } finally {
      setProcessingMarketId(null);
    }
  }

  async function handleResolve(market, resolution) {
    if (!(await confirmToast(`Resolve this market as ${resolution}?`))) return;

    setProcessingMarketId(market.id);
    try {
      const marketRef = doc(db, 'markets', market.id);
      await runTransaction(db, async (tx) => {
        const marketSnap = await tx.get(marketRef);
        if (!marketSnap.exists()) throw new Error('Market not found.');
        const marketData = marketSnap.data();
        if (getMarketStatus(marketData) !== MARKET_STATUS.LOCKED) {
          throw new Error('Lock the market before resolving.');
        }
        tx.update(marketRef, {
          status: MARKET_STATUS.RESOLVED,
          resolution,
          resolvedAt: new Date()
        });
      });

      const betsSnap = await getDocs(query(collection(db, 'bets'), where('marketId', '==', market.id)));
      const positions = {};
      betsSnap.docs.forEach((snapshotDoc) => {
        const bet = snapshotDoc.data();
        if (!positions[bet.userId]) {
          positions[bet.userId] = { yesShares: 0, noShares: 0, yesInvested: 0, noInvested: 0 };
        }
        const sharesAbs = Math.abs(Number(bet.shares || 0));
        const amount = Number(bet.amount || 0);
        const side = bet.side === 'NO' ? 'NO' : 'YES';
        const type = bet.type === 'SELL' ? 'SELL' : 'BUY';
        if (side === 'YES') {
          positions[bet.userId].yesShares = round2(positions[bet.userId].yesShares + (type === 'SELL' ? -sharesAbs : sharesAbs));
          positions[bet.userId].yesInvested = round2(positions[bet.userId].yesInvested + amount);
        } else {
          positions[bet.userId].noShares = round2(positions[bet.userId].noShares + (type === 'SELL' ? -sharesAbs : sharesAbs));
          positions[bet.userId].noInvested = round2(positions[bet.userId].noInvested + amount);
        }
      });

      const operationFns = [];
      Object.entries(positions).forEach(([userId, position]) => {
        const yesShares = Math.max(0, Number(position.yesShares || 0));
        const noShares = Math.max(0, Number(position.noShares || 0));
        const yesInvested = Math.max(0, Number(position.yesInvested || 0));
        const noInvested = Math.max(0, Number(position.noInvested || 0));
        const payout = resolution === 'YES' ? yesShares : noShares;
        const lostInvestment = resolution === 'YES' ? noInvested : yesInvested;

        const memberId = toMarketplaceMemberId(marketplaceId, userId);
        const member = members.find((entry) => entry.id === memberId);
        if (!member) return;

        operationFns.push((batch) => {
          batch.update(doc(db, 'marketplaceMembers', memberId), {
            balance: round2(Number(member.balance || 0) + payout),
            lifetimeRep: round2(Number(member.lifetimeRep || 0) + payout - lostInvestment),
            updatedAt: new Date()
          });
        });

        operationFns.push((batch) => {
          const type = payout > 0 ? 'payout' : 'loss';
          batch.set(doc(collection(db, 'notifications')), {
            userId,
            marketplaceId,
            marketId: market.id,
            marketQuestion: market.question,
            type,
            category: categoryForNotificationType(type),
            amount: round2(payout > 0 ? payout : lostInvestment),
            resolution,
            read: false,
            createdAt: new Date()
          });
        });
      });
      for (const chunk of chunkArray(operationFns, 350)) {
        const batch = writeBatch(db);
        chunk.forEach((applyOp) => applyOp(batch));
        await batch.commit();
      }

      await logCreatorAction('RESOLVE', `Marketplace market resolved as ${resolution}: ${market.question.slice(0, 120)}`);
      notifySuccess(`Resolved as ${resolution}.`);
      await loadData();
    } catch (error) {
      console.error('Error resolving marketplace market:', error);
      notifyError(error?.message || 'Could not resolve market.');
    } finally {
      setProcessingMarketId(null);
    }
  }

  async function handleCancel(market) {
    if (!(await confirmToast('Cancel this market and refund net invested amounts?'))) return;
    setProcessingMarketId(market.id);

    try {
      const betsSnap = await getDocs(query(collection(db, 'bets'), where('marketId', '==', market.id)));
      const bets = betsSnap.docs.map((snapshotDoc) => snapshotDoc.data());
      const refunds = calculateRefundsByUser(bets);

      const operationFns = [];
      Object.entries(refunds).forEach(([userId, refundAmount]) => {
        const memberId = toMarketplaceMemberId(marketplaceId, userId);
        const member = members.find((entry) => entry.id === memberId);
        if (!member) return;
        operationFns.push((batch) => {
          batch.update(doc(db, 'marketplaceMembers', memberId), {
            balance: round2(Number(member.balance || 0) + Number(refundAmount || 0)),
            lifetimeRep: Number(member.lifetimeRep || 0),
            updatedAt: new Date()
          });
        });
        operationFns.push((batch) => {
          const type = 'refund';
          batch.set(doc(collection(db, 'notifications')), {
            userId,
            marketplaceId,
            marketId: market.id,
            marketQuestion: market.question,
            type,
            category: categoryForNotificationType(type),
            amount: round2(refundAmount),
            read: false,
            createdAt: new Date()
          });
        });
      });

      operationFns.push((batch) => {
        batch.update(doc(db, 'markets', market.id), {
          status: MARKET_STATUS.CANCELLED,
          cancelledAt: new Date(),
          lockedAt: null
        });
      });
      for (const chunk of chunkArray(operationFns, 350)) {
        const batch = writeBatch(db);
        chunk.forEach((applyOp) => applyOp(batch));
        await batch.commit();
      }

      await logCreatorAction('DELETE', `Marketplace market cancelled: ${market.question.slice(0, 120)}`);
      notifySuccess('Market cancelled and refunded.');
      await loadData();
    } catch (error) {
      console.error('Error cancelling marketplace market:', error);
      notifyError('Could not cancel market.');
    } finally {
      setProcessingMarketId(null);
    }
  }

  async function handleRunReset() {
    if (!marketplace) return;
    if (
      marketplace.resetMode === MARKETPLACE_RESET_MODE.WEEKLY
      && marketplace.nextResetAt
      && toDate(marketplace.nextResetAt).getTime() > Date.now()
    ) {
      notifyError('Weekly reset is not due yet.');
      return;
    }
    const resetCopy = marketplace.resetMode === MARKETPLACE_RESET_MODE.WEEKLY
      ? 'Run weekly reset now? This will snapshot standings and reset all balances.'
      : 'Run manual reset now? This will snapshot standings and reset all balances.';
    if (!(await confirmToast(resetCopy))) return;

    setResetting(true);
    try {
      const [membersSnap, openMarkets, betsSnap] = await Promise.all([
        getDocs(query(collection(db, 'marketplaceMembers'), where('marketplaceId', '==', marketplaceId))),
        fetchMarketplaceMarkets(marketplaceId),
        getDocs(query(collection(db, 'bets'), where('marketplaceId', '==', marketplaceId)))
      ]);
      const memberRows = membersSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
      const openRows = openMarkets.filter((market) => market.resolution == null && market.status !== MARKET_STATUS.CANCELLED);
      const betRows = betsSnap.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));

      const calculatedRows = calculateMarketplacePortfolioRows({
        members: memberRows,
        bets: betRows,
        openMarkets: openRows,
        startingBalance: Number(marketplace.startingBalance || 500)
      })
        .sort((a, b) => Number(b.portfolioValue || 0) - Number(a.portfolioValue || 0))
        .slice(0, 50);

      const rankings = calculatedRows.map((entry, index) => ({
        userId: entry.userId,
        displayName: getPublicDisplayName({ id: entry.userId, ...(userMap[entry.userId] || {}) }),
        portfolioValue: round2(entry.portfolioValue),
        netProfit: round2(entry.weeklyNet),
        rank: index + 1
      }));

      await addDoc(collection(db, 'marketplaceWeeklySnapshots'), {
        marketplaceId,
        weekOf: mondayIso(),
        snapshotDate: new Date(),
        rankings,
        totalParticipants: calculatedRows.length
      });

      const balanceChunks = chunkArray(memberRows, 400);
      for (const chunk of balanceChunks) {
        const batch = writeBatch(db);
        chunk.forEach((member) => {
          batch.update(doc(db, 'marketplaceMembers', member.id), {
            balance: Number(marketplace.startingBalance || 500),
            updatedAt: new Date()
          });
        });
        await batch.commit();
      }

      await updateDoc(doc(db, 'marketplaces', marketplaceId), {
        lastResetAt: new Date(),
        nextResetAt: marketplace.resetMode === MARKETPLACE_RESET_MODE.WEEKLY ? nextWeeklyResetDate(new Date()) : null,
        updatedAt: new Date()
      });

      await logCreatorAction('RESET', `Marketplace reset run for ${marketplace.name}`);
      notifySuccess('Marketplace reset completed.');
      await loadData();
    } catch (error) {
      console.error('Error running marketplace reset:', error);
      notifyError('Could not run reset.');
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <p className="font-mono text-[var(--text-muted)]">Loading admin...</p>
      </div>
    );
  }

  if (!marketplace || !membership || !isCreator) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-[1150px]">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-6">
          <div>
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              <Link href={`/marketplace/${marketplaceId}`} className="text-[var(--text-dim)] hover:text-[var(--text)]">
                {marketplace.name}
              </Link>{' '}
              / Creator Admin
            </p>
            <h1 className="mt-2 font-display text-[2rem] text-[var(--text)]">Marketplace Controls</h1>
          </div>
          <button
            onClick={handleRunReset}
            disabled={resetting}
            className={`${BTN_BASE} border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.15)] text-[var(--amber-bright)] hover:bg-[rgba(217,119,6,0.25)]`}
          >
            {resetting ? 'Resetting...' : 'Run Reset →'}
          </button>
        </div>

        <form onSubmit={handleCreateMarket} className="mb-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Create Marketplace Market</p>
          <div className="grid gap-3 md:grid-cols-2">
            <input value={question} onChange={(e) => setQuestion(e.target.value)} className={INPUT_CLASS} placeholder="Will there be over 100 unique bird species this weekend?" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT_CLASS}>
              <option value="auto">Auto category</option>
              {CATEGORIES.filter((entry) => entry.id !== 'all').map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.emoji} {entry.label}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={99}
              value={initialProbability}
              onChange={(e) => setInitialProbability(e.target.value)}
              className={INPUT_CLASS}
              placeholder="Initial probability"
            />
            <input
              type="number"
              min={10}
              value={bValue}
              onChange={(e) => setBValue(e.target.value)}
              className={INPUT_CLASS}
              placeholder="Liquidity b"
            />
          </div>
          <textarea
            value={resolutionRules}
            onChange={(e) => setResolutionRules(e.target.value)}
            className={`${INPUT_CLASS} mt-3 min-h-[84px] resize-y`}
            placeholder="Resolution rules for YES/NO"
          />
          <button
            type="submit"
            disabled={createPending}
            className={`${BTN_BASE} mt-3 border-[var(--red-dim)] bg-[var(--red)] text-white hover:bg-[var(--red-dim)]`}
          >
            {createPending ? 'Creating...' : 'Create Market →'}
          </button>
        </form>

        <section>
          <p className="mb-3 flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-[16px] bg-[var(--red)]" />
            Markets
          </p>
          <div className="space-y-2">
            {activeMarkets.length === 0 ? (
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-5 text-sm text-[var(--text-dim)]">
                No active marketplace markets.
              </div>
            ) : (
              activeMarkets.map((market) => {
                const status = getMarketStatus(market);
                const locked = status === MARKET_STATUS.LOCKED;
                return (
                  <div key={market.id} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <Link href={`/market/${market.id}`} className="text-sm font-semibold text-[var(--text)] hover:text-[var(--red)]">
                        {market.question}
                      </Link>
                      <span className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">{status}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleToggleLock(market, locked ? MARKET_STATUS.OPEN : MARKET_STATUS.LOCKED)}
                        disabled={processingMarketId === market.id}
                        className={`${BTN_BASE} border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.15)] text-[var(--amber-bright)] hover:bg-[rgba(217,119,6,0.25)]`}
                      >
                        {locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button
                        onClick={() => handleResolve(market, 'YES')}
                        disabled={!locked || processingMarketId === market.id}
                        className={`${BTN_BASE} border-[rgba(22,163,74,0.25)] bg-[rgba(22,163,74,0.15)] text-[var(--green-bright)] hover:bg-[rgba(22,163,74,0.25)]`}
                      >
                        Resolve YES
                      </button>
                      <button
                        onClick={() => handleResolve(market, 'NO')}
                        disabled={!locked || processingMarketId === market.id}
                        className={`${BTN_BASE} border-[rgba(220,38,38,0.3)] bg-[var(--red-glow)] text-[var(--red)] hover:bg-[rgba(220,38,38,0.15)]`}
                      >
                        Resolve NO
                      </button>
                      <button
                        onClick={() => handleCancel(market)}
                        disabled={processingMarketId === market.id}
                        className={`${BTN_BASE} border-[rgba(220,38,38,0.3)] bg-[var(--red-glow)] text-[var(--red)] hover:bg-[rgba(220,38,38,0.15)]`}
                      >
                        Cancel + Refund
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="mt-8">
          <p className="mb-3 flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-[16px] bg-[var(--red)]" />
            Members
          </p>
          <div className="overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
            {members.map((member) => (
              <div key={member.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
                <span className="text-sm text-[var(--text)]">{getPublicDisplayName({ id: member.userId, ...(userMap[member.userId] || {}) })}</span>
                <span className="rounded border border-[var(--border2)] px-2 py-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  {member.role}
                </span>
                <span className="font-mono text-[0.72rem] text-[var(--amber-bright)]">${Number(member.balance || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <ToastStack toasts={toasts} onDismiss={removeToast} onConfirm={resolveConfirm} />
    </div>
  );
}
