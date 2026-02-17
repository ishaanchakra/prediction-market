'use client';
import { useEffect, useState } from 'react';
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
import { getPublicDisplayName, isValidDisplayName, normalizeDisplayName } from '@/utils/displayName';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import PortfolioView from '@/app/components/PortfolioView';

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
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
                marketCancelledAt: marketData.cancelledAt || null,
                marketCategory: marketData.category || 'wildcard'
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
                marketCancelledAt: null,
                marketCategory: 'wildcard'
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

  if (loading) {
    return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;
  }
  if (!user) return null;

  const displayName = getPublicDisplayName({ id: user.uid, ...user });
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'PC';
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

        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center sm:text-left">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Weekly Balance</p>
            <p className="font-mono text-[2.5rem] font-bold leading-none text-[var(--amber-bright)]">${Number(user.weeklyRep || 0).toFixed(2)}</p>
            <p className="mt-2 font-mono text-[0.6rem] text-[var(--text-muted)]">Resets every Monday</p>
          </div>
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center sm:text-left">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Lifetime Earnings</p>
            <p className="font-mono text-[2.5rem] font-bold leading-none text-[var(--amber-bright)]">${Number(user.lifetimeRep || 0).toFixed(2)}</p>
            <p className="mt-2 font-mono text-[0.6rem] text-[var(--text-muted)]">Cumulative resolved-market net</p>
          </div>
        </div>

        <PortfolioView
          userId={user.uid}
          user={{ ...user, weeklyRank, traderCount }}
          bets={bets}
          isOwnProfile
        />
      </div>
    </div>
  );
}
