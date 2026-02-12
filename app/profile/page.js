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
  runTransaction,
  serverTimestamp
} from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import InfoTooltip from '@/app/components/InfoTooltip';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import { isValidDisplayName, normalizeDisplayName, getPublicDisplayName } from '@/utils/displayName';

function round2(num) {
  return Math.round(num * 100) / 100;
}

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
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
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        if (userDoc.exists()) {
          const data = { uid: currentUser.uid, ...userDoc.data() };
          setUser(data);
          setDisplayNameDraft(data.displayName || getPublicDisplayName({ id: currentUser.uid, ...data }));
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
                marketStatus: getMarketStatus(marketData)
              };
            } catch (error) {
              return {
                id: betDoc.id,
                ...betData,
                marketQuestion: 'Error loading market',
                marketStatus: MARKET_STATUS.OPEN
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
      } catch (error) {
        console.error('Error fetching profile:', error);
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

        if (currentNormalized && currentNormalized !== normalized) {
          const oldKeyRef = doc(db, 'displayNames', currentNormalized);
          const oldKeySnap = await tx.get(oldKeyRef);
          if (oldKeySnap.exists() && oldKeySnap.data().userId === user.uid) {
            tx.delete(oldKeyRef);
          }
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

  if (loading) return <div className="p-8 bg-brand-red text-white min-h-screen">Loading...</div>;
  if (!user) return null;

  return (
    <div className="p-8 max-w-4xl mx-auto bg-brand-red min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 text-white">Your Profile</h1>
        <p className="text-white opacity-90">{user.email}</p>
      </div>

      <div className="bg-white border-2 border-brand-pink rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-gray-900">Display Name</h2>

        {!editingDisplayName ? (
          <div className="flex items-center justify-between">
            <p className="text-gray-900 font-semibold text-lg">{getPublicDisplayName({ id: user.uid, ...user })}</p>
            <button
              onClick={() => {
                setEditingDisplayName(true);
                setNameStatus('idle');
                setNameMessage('');
              }}
              className="bg-brand-red text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-darkred"
            >
              Edit Display Name
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              value={displayNameDraft}
              onChange={(e) => setDisplayNameDraft(e.target.value)}
              maxLength={24}
              className="w-full rounded-lg border px-3 py-2 text-gray-900"
            />
            {nameMessage && (
              <p
                className={`text-sm ${
                  nameStatus === 'available' ? 'text-green-700' : nameStatus === 'taken' || nameStatus === 'invalid' || nameStatus === 'error' ? 'text-red-700' : 'text-gray-700'
                }`}
              >
                {nameMessage}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSaveDisplayName}
                disabled={savingName || nameStatus === 'taken' || nameStatus === 'invalid' || !displayNameDraft.trim()}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-green-700 disabled:bg-gray-300"
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
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gradient-to-br from-brand-red to-brand-darkred rounded-lg p-6 text-white border-2 border-white">
          <p className="text-sm opacity-90 mb-1">Balance</p>
          <p className="text-4xl font-bold">${round2(user.weeklyRep || 0)}</p>
          <p className="text-sm opacity-75 mt-2">Resets every Monday</p>
        </div>

        <div className="bg-gradient-to-br from-brand-pink to-brand-red rounded-lg p-6 text-white border-2 border-white">
          <p className="text-sm opacity-90 mb-1">Lifetime Earnings</p>
          <p className="text-4xl font-bold">${round2(user.lifetimeRep || 0)}</p>
          <p className="text-sm opacity-75 mt-2">Net winnings over all time</p>
        </div>
      </div>

      <PositionSection
        title={`Active Positions (${activePositions.length})`}
        emptyLabel={
          <>No active positions. <Link href="/" className="text-brand-red hover:underline font-semibold">Browse markets</Link></>
        }
        bets={activePositions}
      />

      <div className="h-6" />

      <PositionSection
        title={`Closed Positions (${closedPositions.length})`}
        emptyLabel="No closed positions yet."
        bets={closedPositions}
      />
    </div>
  );
}

function PositionSection({ title, emptyLabel, bets }) {
  return (
    <div className="bg-white rounded-lg border-2 border-brand-pink p-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 flex items-center gap-2">
        {title}
        <InfoTooltip
          label="What are shares?"
          text="Shares are your position size. If your side wins, your shares become payout."
        />
      </h2>

      {bets.length === 0 ? (
        <p className="text-gray-500">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {bets.map((bet) => (
            <Link
              key={bet.id}
              href={`/market/${bet.marketId}`}
              className="block border-2 border-gray-200 rounded-lg p-4 hover:bg-gray-50 hover:border-brand-pink transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    bet.side === 'YES' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {bet.side}
                  </span>
                  <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                    {bet.marketStatus}
                  </span>
                </div>
                <span className="text-sm text-gray-500">
                  {bet.timestamp?.toDate?.()?.toLocaleDateString() || 'Recently'}
                </span>
              </div>
              <p className="font-medium text-gray-900 mb-2">{bet.marketQuestion || 'Loading...'}</p>
              <p className="text-gray-900 mb-1">Amount: <span className="font-semibold">${round2(Math.abs(bet.amount || 0))}</span></p>
              <p className="text-sm text-gray-600">Shares: {round2(bet.shares || 0)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
