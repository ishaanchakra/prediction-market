'use client';
import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import { isValidDisplayName, normalizeDisplayName, getPublicDisplayName } from '@/utils/displayName';

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [activeTab, setActiveTab] = useState('open');
  const [weeklyRank, setWeeklyRank] = useState(null);
  const [traderCount, setTraderCount] = useState(0);
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [nameStatus, setNameStatus] = useState('idle');
  const [nameMessage, setNameMessage] = useState('');
  const [savingName, setSavingName] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      try {
        setProfileError('');
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          const data = { uid: currentUser.uid, ...userDoc.data() };
          setUser(data);
          setDisplayNameDraft(data.displayName || getPublicDisplayName({ id: currentUser.uid, ...data }));
        } else {
          setUser({
            uid: currentUser.uid,
            email: currentUser.email || '',
            weeklyRep: 1000,
            lifetimeRep: 0
          });
          setDisplayNameDraft(currentUser.email?.split('@')[0] || 'trader');
          setProfileError('Profile data is still initializing. Some values may be delayed.');
        }

        const betsQuery = query(collection(db, 'bets'), where('userId', '==', currentUser.uid));
        const betsSnapshot = await getDocs(betsQuery);

        const betsWithMarkets = await Promise.all(
          betsSnapshot.docs.map(async (betDoc) => {
            const betData = betDoc.data();
            try {
              const marketDoc = await getDoc(doc(db, 'markets', betData.marketId));
              const marketData = marketDoc.exists() ? marketDoc.data() : {};
              return {
                id: betDoc.id,
                ...betData,
                marketQuestion: marketDoc.exists() ? marketData.question : 'Market not found',
                marketStatus: getMarketStatus(marketData),
                marketResolution: marketData.resolution || null,
                marketProbability: Number(marketData.probability || 0),
                marketResolutionDate: marketData.resolutionDate || null,
                marketResolvedAt: marketData.resolvedAt || null,
                marketCancelledAt: marketData.cancelledAt || null
              };
            } catch (error) {
              return {
                id: betDoc.id,
                ...betData,
                marketQuestion: 'Error loading market',
                marketStatus: MARKET_STATUS.OPEN,
                marketResolution: null,
                marketProbability: 0,
                marketResolutionDate: null,
                marketResolvedAt: null,
                marketCancelledAt: null
              };
            }
          })
        );

        setBets(
          betsWithMarkets.sort((a, b) => {
            const aTime = a.timestamp?.toDate?.()?.getTime?.() || 0;
            const bTime = b.timestamp?.toDate?.()?.getTime?.() || 0;
            return bTime - aTime;
          })
        );

        const usersQuery = query(collection(db, 'users'), orderBy('weeklyRep', 'desc'), limit(500));
        const usersSnapshot = await getDocs(usersQuery);
        const usersRows = usersSnapshot.docs.map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
        const rank = usersRows.findIndex((entry) => entry.id === currentUser.uid);
        setWeeklyRank(rank >= 0 ? rank + 1 : null);
        setTraderCount(usersRows.length);
      } catch (error) {
        console.error('Error fetching profile:', error);
        setProfileError('Unable to load full profile data right now.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function checkDisplayNameAvailability() {
      if (!editingDisplayName) return;

      const trimmed = displayNameDraft.trim().replace(/\s+/g, ' ');
      if (!trimmed) {
        setNameStatus('idle');
        setNameMessage('');
        return;
      }

      if (!isValidDisplayName(trimmed)) {
        setNameStatus('invalid');
        setNameMessage('Use 3-24 chars: letters, numbers, spaces, _ or -.');
        return;
      }

      const normalized = normalizeDisplayName(trimmed);
      if (normalized === user?.displayNameNormalized) {
        setNameStatus('available');
        setNameMessage('This is your current display name.');
        return;
      }

      try {
        const keyDoc = await getDoc(doc(db, 'displayNames', normalized));
        if (cancelled) return;

        if (!keyDoc.exists() || keyDoc.data().userId === user?.uid) {
          setNameStatus('available');
          setNameMessage('Display name is available.');
        } else {
          setNameStatus('taken');
          setNameMessage('That display name is already taken.');
        }
      } catch (error) {
        if (!cancelled) {
          setNameStatus('error');
          setNameMessage('Could not verify display name right now.');
        }
      }
    }

    checkDisplayNameAvailability();

    return () => {
      cancelled = true;
    };
  }, [displayNameDraft, editingDisplayName, user]);

  const activePositions = useMemo(
    () => bets.filter((bet) => [MARKET_STATUS.OPEN, MARKET_STATUS.LOCKED].includes(bet.marketStatus)),
    [bets]
  );

  const closedPositions = useMemo(
    () => bets.filter((bet) => [MARKET_STATUS.RESOLVED, MARKET_STATUS.CANCELLED].includes(bet.marketStatus)),
    [bets]
  );

  const resolvedBuys = useMemo(
    () => closedPositions.filter((bet) => bet.marketStatus === MARKET_STATUS.RESOLVED && Number(bet.amount || 0) > 0),
    [closedPositions]
  );
  const winCount = useMemo(
    () => resolvedBuys.filter((bet) => bet.side === bet.marketResolution).length,
    [resolvedBuys]
  );
  const winRate = resolvedBuys.length > 0 ? Math.round((winCount / resolvedBuys.length) * 100) : 0;

  async function handleSaveDisplayName() {
    if (!user) return;

    const trimmed = displayNameDraft.trim().replace(/\s+/g, ' ');
    if (!isValidDisplayName(trimmed)) {
      setNameStatus('invalid');
      setNameMessage('Use 3-24 chars: letters, numbers, spaces, _ or -.');
      return;
    }

    const normalized = normalizeDisplayName(trimmed);
    setSavingName(true);

    try {
      await runTransaction(db, async (tx) => {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) {
          throw new Error('User profile missing.');
        }

        const current = userSnap.data();
        const currentNormalized = current.displayNameNormalized || '';
        const newKeyRef = doc(db, 'displayNames', normalized);
        const newKeySnap = await tx.get(newKeyRef);
        let oldKeyRef = null;
        let oldKeySnap = null;

        if (currentNormalized && currentNormalized !== normalized) {
          oldKeyRef = doc(db, 'displayNames', currentNormalized);
          oldKeySnap = await tx.get(oldKeyRef);
        }

        if (newKeySnap.exists() && newKeySnap.data().userId !== user.uid) {
          throw new Error('Display name already taken.');
        }

        tx.set(
          newKeyRef,
          {
            userId: user.uid,
            originalName: trimmed,
            updatedAt: serverTimestamp(),
            createdAt: newKeySnap.exists() ? (newKeySnap.data().createdAt || serverTimestamp()) : serverTimestamp()
          },
          { merge: true }
        );

        tx.update(userRef, {
          displayName: trimmed,
          displayNameNormalized: normalized
        });

        if (oldKeyRef && oldKeySnap?.exists() && oldKeySnap.data().userId === user.uid) {
          tx.delete(oldKeyRef);
        }
      });

      setUser((prev) => ({
        ...prev,
        displayName: trimmed,
        displayNameNormalized: normalized
      }));
      setEditingDisplayName(false);
      setNameStatus('idle');
      setNameMessage('');
    } catch (error) {
      setNameStatus('error');
      setNameMessage(error.message || 'Could not save display name.');
    } finally {
      setSavingName(false);
    }
  }

  if (loading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;
  if (!user) return null;

  const displayName = getPublicDisplayName({ id: user.uid, ...user });
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'PC';
  const weeklyNet = Number(user.weeklyRep || 0) - 1000;
  const lifetimeNet = Number(user.lifetimeRep || 0);
  const shownBets = activeTab === 'open' ? activePositions : closedPositions;
  const memberSince = user?.createdAt?.toDate?.()
    ? user.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : 'Unknown';

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto max-w-[960px]">
        {profileError && (
          <div className="mb-5 rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
            {profileError}
          </div>
        )}
        <div className="mb-10 flex flex-col items-start justify-between gap-5 border-b border-[var(--border)] pb-8 md:flex-row md:items-end">
          <div className="flex items-center gap-4 md:gap-5">
            <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[var(--border2)] bg-[var(--surface2)] font-mono text-[1.1rem] font-bold text-[var(--red)]">
              {initials}
            </div>
            <div>
              <p className="font-display text-[1.8rem] leading-none text-[var(--text)]">{displayName}</p>
              <p className="mt-1 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Cornell · member since {memberSince}
              </p>
            </div>
          </div>
          {!editingDisplayName ? (
            <button
              onClick={() => {
                setEditingDisplayName(true);
                setNameStatus('idle');
                setNameMessage('');
              }}
              className="rounded border border-[var(--border2)] px-4 py-2 font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)]"
            >
              Edit Display Name
            </button>
          ) : (
            <div className="w-full max-w-[420px] space-y-2">
              <input
                type="text"
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                maxLength={24}
                className="w-full rounded border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 font-mono text-[0.8rem] text-[var(--text)]"
              />
              {nameMessage && (
                <p className={`text-xs ${nameStatus === 'available' ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                  {nameMessage}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveDisplayName}
                  disabled={savingName || nameStatus === 'taken' || nameStatus === 'invalid' || !displayNameDraft.trim()}
                  className="rounded border border-[rgba(22,163,74,0.25)] bg-[rgba(22,163,74,0.15)] px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--green-bright)] disabled:opacity-60"
                >
                  {savingName ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditingDisplayName(false);
                    setDisplayNameDraft(user.displayName || getPublicDisplayName({ id: user.uid, ...user }));
                    setNameStatus('idle');
                    setNameMessage('');
                  }}
                  className="rounded border border-[var(--border2)] px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.06em] text-[var(--text-dim)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mb-10 grid gap-[1px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--border)] grid-cols-1 md:grid-cols-4">
          <StatCell label="Weekly Balance" value={`$${Number(user.weeklyRep || 0).toFixed(2)}`} sub={`${weeklyNet >= 0 ? '+' : '-'}$${Math.abs(weeklyNet).toFixed(2)} this week`} tone="amber" />
          <StatCell label="Lifetime P&L" value={`${lifetimeNet >= 0 ? '+' : '-'}$${Math.abs(lifetimeNet).toFixed(2)}`} sub="across all time" tone="green" />
          <StatCell label="Win Rate" value={`${winRate}%`} sub={`${winCount} of ${resolvedBuys.length} resolved`} tone="dim" />
          <StatCell label="Weekly Rank" value={weeklyRank ? `#${weeklyRank}` : '—'} sub={`of ${traderCount} traders`} tone="red" />
        </div>

        <p className="mb-4 flex items-center gap-2 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <span className="inline-block h-px w-[14px] bg-[var(--red)]" />
          Positions
        </p>

        <div className="mb-6 flex border-b border-[var(--border)]">
          <button
            onClick={() => setActiveTab('open')}
            className={`mb-[-1px] border-b-2 px-5 py-3 font-mono text-[0.62rem] uppercase tracking-[0.06em] ${
              activeTab === 'open' ? 'border-[var(--red)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)]'
            }`}
          >
            Open
            <span className={`ml-2 rounded-[3px] px-1.5 py-[0.1rem] text-[0.5rem] ${activeTab === 'open' ? 'bg-[var(--red-glow)] text-[var(--red)]' : 'bg-[var(--surface2)] text-[var(--text-muted)]'}`}>
              {activePositions.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('closed')}
            className={`mb-[-1px] border-b-2 px-5 py-3 font-mono text-[0.62rem] uppercase tracking-[0.06em] ${
              activeTab === 'closed' ? 'border-[var(--red)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)]'
            }`}
          >
            Closed
            <span className={`ml-2 rounded-[3px] px-1.5 py-[0.1rem] text-[0.5rem] ${activeTab === 'closed' ? 'bg-[var(--red-glow)] text-[var(--red)]' : 'bg-[var(--surface2)] text-[var(--text-muted)]'}`}>
              {closedPositions.length}
            </span>
          </button>
        </div>

        {shownBets.length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-8 py-14 text-center">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {activeTab === 'open' ? 'No active positions' : 'No closed positions'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-[1px]">
            {shownBets.map((bet) => (
              <PositionCard key={bet.id} bet={bet} closed={activeTab === 'closed'} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value, sub, tone }) {
  const toneClass = tone === 'amber'
    ? 'text-[var(--amber-bright)]'
    : tone === 'green'
      ? 'text-[var(--green-bright)]'
      : tone === 'red'
        ? 'text-[var(--red)]'
        : 'text-[var(--text-dim)]';
  return (
    <div className="bg-[var(--surface)] px-5 py-4 text-center md:text-left">
      <p className="mb-1 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
      <p className={`font-mono text-[2rem] font-bold tracking-[-0.02em] md:text-[1.4rem] ${toneClass}`}>{value}</p>
      <p className="mt-1 font-mono text-[0.55rem] text-[var(--text-muted)]">{sub}</p>
    </div>
  );
}

function PositionCard({ bet, closed }) {
  const invested = Math.abs(Number(bet.amount || 0));
  const shares = Math.abs(Number(bet.shares || 0));
  const prob = Math.round(Number(bet.marketProbability || 0) * 100);
  const isYes = bet.side === 'YES';
  const isLocked = bet.marketStatus === MARKET_STATUS.LOCKED;
  const isCancelled = bet.marketStatus === MARKET_STATUS.CANCELLED;
  const resolved = bet.marketStatus === MARKET_STATUS.RESOLVED;
  const won = resolved && bet.side === bet.marketResolution;

  const impliedExit = isYes ? shares * (Number(bet.marketProbability || 0)) : shares * (1 - Number(bet.marketProbability || 0));
  const payout = isCancelled ? invested : (won ? shares : 0);
  const pnl = closed ? payout - invested : impliedExit - invested;
  const pnlClass = pnl >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]';

  const statusBadge = isCancelled
    ? 'badge-cancelled'
    : resolved
      ? won ? 'badge-resolved-yes' : 'badge-resolved-no'
      : isLocked ? 'badge-locked' : 'badge-open';

  const statusText = isCancelled
    ? 'Cancelled'
    : resolved
      ? `Resolved ${bet.marketResolution === 'YES' ? 'YES ✓' : 'NO ✗'}`
      : isLocked ? 'Locked' : 'Open';

  const fillClass = prob > 65 ? 'bg-[var(--green-bright)]' : prob < 35 ? 'bg-[var(--red)]' : 'bg-[var(--amber-bright)]';
  const resolvedDate = bet.marketResolvedAt?.toDate?.()?.toLocaleDateString?.() || bet.marketCancelledAt?.toDate?.()?.toLocaleDateString?.() || 'Recently';
  const resolveDate = bet.marketResolutionDate?.toDate?.()?.toLocaleDateString?.() || 'TBD';

  return (
    <Link
      href={`/market/${bet.marketId}`}
      className="grid grid-cols-[3px_1fr_auto] overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--border2)] hover:bg-[var(--surface2)]"
    >
      <div className={closed ? 'bg-[var(--border2)]' : isYes ? 'bg-[var(--green-bright)] opacity-70' : 'bg-[var(--red)] opacity-70'} />
      <div className="flex flex-col gap-2 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-[0.88rem] font-semibold leading-[1.4] text-[var(--text)]">{bet.marketQuestion || 'Loading...'}</p>
          <div className="flex items-center gap-2">
            <span className={`rounded-[3px] border px-2 py-[0.2rem] font-mono text-[0.52rem] font-bold uppercase tracking-[0.06em] ${isYes ? 'border-[rgba(34,197,94,.25)] bg-[rgba(34,197,94,.12)] text-[var(--green-bright)]' : 'border-[rgba(220,38,38,.25)] bg-[var(--red-glow)] text-[var(--red)]'}`}>
              {bet.side}
            </span>
            <span className={`rounded-[3px] border px-2 py-[0.2rem] font-mono text-[0.52rem] font-bold uppercase tracking-[0.06em] ${
              statusBadge === 'badge-open'
                ? 'border-[var(--border2)] bg-[var(--surface3)] text-[var(--text-muted)]'
                : statusBadge === 'badge-locked'
                  ? 'border-[rgba(245,158,11,.25)] bg-[rgba(245,158,11,.1)] text-[var(--amber-bright)]'
                  : statusBadge === 'badge-resolved-yes'
                    ? 'border-[rgba(34,197,94,.2)] bg-[rgba(34,197,94,.08)] text-[var(--green-bright)]'
                    : statusBadge === 'badge-resolved-no'
                      ? 'border-[rgba(220,38,38,.2)] bg-[var(--red-glow)] text-[var(--red)]'
                      : 'border-[var(--border)] bg-[var(--surface3)] text-[var(--text-muted)]'
            }`}>
              {statusText}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <MetaItem label="Invested" value={`$${invested.toFixed(2)}`} />
          <MetaItem label="Shares" value={shares.toFixed(1)} />
          <MetaItem label={closed ? (isCancelled ? 'Refunded' : 'Payout') : 'Exit Value'} value={`$${(closed ? payout : impliedExit).toFixed(2)}`} tone={closed ? (won || isCancelled ? 'positive' : 'negative') : pnl >= 0 ? 'positive' : 'negative'} />
          {!closed ? (
            <div>
              <p className="font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Current Prob</p>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-[3px] w-[60px] overflow-hidden rounded-[2px] bg-[var(--surface3)]">
                  <div className={`h-full rounded-[2px] ${fillClass}`} style={{ width: `${prob}%` }} />
                </div>
                <span className="font-mono text-[0.78rem] font-bold text-[var(--text)]">{prob}%</span>
              </div>
            </div>
          ) : (
            <MetaItem label="Bet At" value={`${prob}%`} tone="muted" />
          )}
          <MetaItem label={closed ? 'Closed' : 'Resolves'} value={closed ? resolvedDate : resolveDate} tone="muted" />
        </div>
      </div>

      <div className="flex min-w-[110px] flex-col items-end justify-center border-l border-[var(--border)] px-5 py-4">
        <p className="mb-1 font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {closed ? (isCancelled ? 'Refund' : 'Net Result') : (isLocked ? `If ${bet.side} wins` : 'Exit Now')}
        </p>
        {closed ? (
          <p className={`font-mono text-[1.4rem] font-bold leading-none tracking-[-0.03em] ${isCancelled ? 'text-[var(--text-muted)]' : pnlClass}`}>
            {isCancelled ? `$${payout.toFixed(2)}` : `${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`}
          </p>
        ) : (
          <p className={`font-mono text-[1.4rem] font-bold leading-none tracking-[-0.03em] ${pnlClass}`}>
            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
          </p>
        )}
        <p className="mt-1 font-mono text-[0.55rem] text-[var(--text-muted)]">
          {invested > 0 ? `${pnl >= 0 ? '+' : '-'}${Math.abs((pnl / invested) * 100).toFixed(1)}%` : ''}
        </p>
      </div>
    </Link>
  );
}

function MetaItem({ label, value, tone }) {
  return (
    <div>
      <p className="font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className={`font-mono text-[0.78rem] font-bold ${
        tone === 'positive'
          ? 'text-[var(--green-bright)]'
          : tone === 'negative'
            ? 'text-[var(--red)]'
            : tone === 'muted'
              ? 'text-[var(--text-dim)]'
              : 'text-[var(--text)]'
      }`}>
        {value}
      </p>
    </div>
  );
}
