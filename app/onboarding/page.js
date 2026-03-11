'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  setDoc,
  serverTimestamp,
  where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '@/lib/firebase';
import { isValidDisplayName, normalizeDisplayName } from '@/utils/displayName';
import { isTradeableMarket } from '@/utils/marketStatus';
import { CATEGORIES } from '@/utils/categorize';
import { round2 } from '@/utils/round';
import { getISOWeek } from '@/utils/isoWeek';
import { ANALYTICS_EVENTS, trackEvent } from '@/utils/analytics';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';
import { buildLoginPath, sanitizeInternalRedirectPath } from '@/utils/redirect';

const FF_CARD_LIMIT = 5;
const DISPLAY_NAME_TAKEN_ERROR = 'This display name is already taken.';

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

function probabilityColor(probability) {
  if (probability > 0.65) return 'var(--green-bright)';
  if (probability < 0.35) return 'var(--red)';
  return 'var(--amber-bright)';
}

function categoryMeta(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId) || { id: 'wildcard', label: 'Wildcard', emoji: '🎲' };
}

function defaultProfileForUser(user) {
  const netId = (user?.email || '').split('@')[0] || 'trader';
  const normalized = normalizeDisplayName(netId);
  return {
    balance: 1000,
    totalDeposits: 1000,
    accountCreatedAt: new Date(),
    lastStipendWeek: null,
    lifetimeRep: 0,
    oracleScore: 0,
    oracleMarketsScored: 0,
    oracleRawBrierSum: 0,
    quickTakesUsedToday: 0,
    quickTakeLastDate: null,
    quickTakeStreak: 0,
    createdAt: new Date(),
    displayName: netId,
    displayNameNormalized: normalized,
    onboardingComplete: false
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toasts, notifyError, removeToast, resolveConfirm } = useToastQueue();
  const nextPath = useMemo(
    () => sanitizeInternalRedirectPath(searchParams.get('next'), '/'),
    [searchParams]
  );
  const loginPath = useMemo(() => {
    const onboardingPath = nextPath === '/' ? '/onboarding' : `/onboarding?next=${encodeURIComponent(nextPath)}`;
    return buildLoginPath(onboardingPath);
  }, [nextPath]);

  const [authUser, setAuthUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [step, setStep] = useState(1);
  const [betAmount, setBetAmount] = useState(100);

  const [netId, setNetId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [hotMarkets, setHotMarkets] = useState([]);
  const [tutorialLoading, setTutorialLoading] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [choices, setChoices] = useState([]);
  const [placedBets, setPlacedBets] = useState([]);
  const [remainingBalance, setRemainingBalance] = useState(1000);

  const [dragState, setDragState] = useState({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });
  const [exitDirection, setExitDirection] = useState(null);
  const [animatingOut, setAnimatingOut] = useState(false);
  const [placingBet, setPlacingBet] = useState(false);
  const stepThreeTrackedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        router.push(loginPath);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const userPrivateRef = doc(db, 'userPrivate', user.uid);
        if (user.email) {
          await setDoc(userPrivateRef, {
            email: String(user.email).toLowerCase(),
            updatedAt: new Date()
          }, { merge: true });
        }
        let userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          const defaults = defaultProfileForUser(user);
          await setDoc(userRef, defaults, { merge: true });
          userSnap = await getDoc(userRef);
        }

        const userData = userSnap.exists() ? userSnap.data() : defaultProfileForUser(user);
        if (userData.onboardingComplete === true) {
          router.push(nextPath);
          return;
        }

        const nextNetId = (user.email || '').split('@')[0] || 'trader';
        setAuthUser(user);
        setNetId(nextNetId);
        setDisplayName(userData.displayName || nextNetId);
        setRemainingBalance(Number(userData.balance || 1000));
      } catch (error) {
        console.error('Error loading onboarding user:', error);
        notifyError('Unable to load onboarding right now.');
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsubscribe();
  }, [loginPath, nextPath, notifyError, router]);

  useEffect(() => {
    if (step !== 3) return undefined;

    function handleKeydown(event) {
      if (animatingOut || placingBet) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleSwipeChoice('YES');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleSwipeChoice('NO');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        handleSwipeChoice('SKIP');
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, animatingOut, placingBet, currentCardIndex, hotMarkets]);

  const topCard = hotMarkets[currentCardIndex];

  async function markOnboardingComplete() {
    if (!authUser) return;
    try {
      await runTransaction(db, async (tx) => {
        const userRef = doc(db, 'users', authUser.uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists()) throw new Error('User profile missing');
        tx.update(userRef, { onboardingComplete: true });
      });
      trackEvent(ANALYTICS_EVENTS.ONBOARDING_STEP_COMPLETED, {
        step: 4,
        tutorialBetsPlaced: placedBets.length
      });
      router.push(nextPath);
    } catch (error) {
      console.error('Error finishing onboarding:', error);
      notifyError('Could not complete onboarding. Please try again.');
    }
  }

  async function loadFiveFutures() {
    setTutorialLoading(true);
    try {
      const currentWeek = getISOWeek();
      const ffSnapshot = await getDocs(
        query(
          collection(db, 'markets'),
          where('isFiveFutures', '==', true),
          where('fiveFuturesWeek', '==', currentWeek),
          where('marketplaceId', '==', null)
        )
      );

      let candidates = ffSnapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((market) => isTradeableMarket(market))
        .sort((a, b) => (a.fiveFuturesIndex || 0) - (b.fiveFuturesIndex || 0))
        .slice(0, FF_CARD_LIMIT);

      if (candidates.length === 0) {
        const fallbackSnapshot = await getDocs(
          query(
            collection(db, 'markets'),
            where('marketplaceId', '==', null),
            where('resolution', '==', null),
            limit(30)
          )
        );
        candidates = fallbackSnapshot.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .filter((market) => isTradeableMarket(market) && !market.marketplaceId)
          .slice(0, FF_CARD_LIMIT);
      }

      if (candidates.length === 0) {
        await markOnboardingComplete();
        return;
      }

      const perBet = Math.max(10, Math.floor(remainingBalance / candidates.length));
      setBetAmount(perBet);

      const selected = candidates.map((market) => ({
        id: market.id,
        question: market.question,
        probability: Number(market.probability || 0.5),
        category: market.category || 'wildcard',
        totalVolume: Number(market.totalVolume || 0)
      }));

      setHotMarkets(selected);
      setChoices(Array(selected.length).fill(null));
      setCurrentCardIndex(0);
      stepThreeTrackedRef.current = false;
      setStep(3);
    } catch (error) {
      console.error('Error loading Five Futures:', error);
      notifyError('Could not load markets. Sending you to the app.');
      await markOnboardingComplete();
    } finally {
      setTutorialLoading(false);
    }
  }

  async function handleNameSubmit() {
    if (!authUser) return;

    const trimmed = displayName.trim().replace(/\s+/g, ' ') || netId;
    if (!isValidDisplayName(trimmed)) {
      setNameError('Display names must be 3-24 chars, letters/numbers/spaces/_/- only.');
      return;
    }

    setSavingName(true);
    setNameError('');

    try {
      await runTransaction(db, async (tx) => {
        const normalized = normalizeDisplayName(trimmed);
        const userRef = doc(db, 'users', authUser.uid);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.exists() ? userSnap.data() : {};
        const currentNormalized = userData.displayNameNormalized || '';
        const newKeyRef = doc(db, 'displayNames', normalized);
        const newKeySnap = await tx.get(newKeyRef);
        const shouldDeleteOldKey = Boolean(currentNormalized && currentNormalized !== normalized);
        const oldKeyRef = shouldDeleteOldKey ? doc(db, 'displayNames', currentNormalized) : null;
        const oldKeySnap = oldKeyRef ? await tx.get(oldKeyRef) : null;

        if (newKeySnap.exists() && newKeySnap.data()?.userId !== authUser.uid) {
          throw new Error(DISPLAY_NAME_TAKEN_ERROR);
        }

        if (!userSnap.exists()) {
          tx.set(userRef, {
            ...defaultProfileForUser(authUser),
            createdAt: serverTimestamp()
          }, { merge: true });
        }

        tx.set(newKeyRef, {
          userId: authUser.uid,
          originalName: trimmed,
          createdAt: newKeySnap.exists() ? (newKeySnap.data()?.createdAt || serverTimestamp()) : serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });

        tx.set(userRef, {
          displayName: trimmed,
          displayNameNormalized: normalized,
          onboardingComplete: false
        }, { merge: true });

        if (oldKeyRef && oldKeySnap?.exists() && oldKeySnap.data()?.userId === authUser.uid) {
            tx.delete(oldKeyRef);
        }
      });

      trackEvent(ANALYTICS_EVENTS.ONBOARDING_STEP_COMPLETED, {
        step: 2
      });
      loadFiveFutures();
    } catch (error) {
      setNameError(error?.message || 'Could not lock display name right now.');
    } finally {
      setSavingName(false);
    }
  }

  async function placeOnboardingBet(market, side) {
    if (!authUser) throw new Error('You must be logged in to place bets.');
    const placeBetCallable = httpsCallable(functions, 'placeBet');
    try {
      await placeBetCallable({
        marketId: market.id,
        side,
        amount: betAmount,
        marketplaceId: null
      });
    } catch (error) {
      throw new Error(getCallableErrorMessage(error, 'Bet failed. Please try again.'));
    }
  }

  async function handleSwipeChoice(choice) {
    if (animatingOut || placingBet || !topCard) return;

    const direction = choice === 'YES' ? 'right' : choice === 'NO' ? 'left' : 'up';
    setExitDirection(direction);
    setAnimatingOut(true);

    let resolvedChoice = choice;

    const startingBalance = remainingBalance;

    if ((choice === 'YES' || choice === 'NO') && startingBalance >= betAmount) {
      setPlacingBet(true);
      try {
        await placeOnboardingBet(topCard, choice);
        setRemainingBalance(round2(startingBalance - betAmount));
        setPlacedBets((prev) => [...prev, { marketId: topCard.id, question: topCard.question, side: choice, amount: betAmount }]);
      } catch (error) {
        notifyError(error?.message || 'Bet failed. Skipping this card.');
        resolvedChoice = 'SKIP';
      } finally {
        setPlacingBet(false);
      }
    } else if (choice !== 'SKIP' && startingBalance < betAmount) {
      resolvedChoice = 'SKIP';
    }

    setChoices((prev) => {
      const next = [...prev];
      next[currentCardIndex] = resolvedChoice;
      return next;
    });

    setTimeout(() => {
      const nextIndex = currentCardIndex + 1;
      setCurrentCardIndex(nextIndex);
      setDragState({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });
      setExitDirection(null);
      setAnimatingOut(false);

      const nextBalance = (choice === 'YES' || choice === 'NO') && resolvedChoice !== 'SKIP'
        ? round2(startingBalance - betAmount)
        : startingBalance;

      if (nextIndex < hotMarkets.length && nextBalance < betAmount) {
        setChoices((prev) => {
          const nextChoices = [...prev];
          for (let idx = nextIndex; idx < hotMarkets.length; idx += 1) {
            if (!nextChoices[idx]) nextChoices[idx] = 'SKIP';
          }
          return nextChoices;
        });
        setCurrentCardIndex(hotMarkets.length);
        if (!stepThreeTrackedRef.current) {
          stepThreeTrackedRef.current = true;
          trackEvent(ANALYTICS_EVENTS.ONBOARDING_STEP_COMPLETED, {
            step: 3,
            cardsSeen: hotMarkets.length,
            betsPlaced: placedBets.length + (resolvedChoice === 'YES' || resolvedChoice === 'NO' ? 1 : 0)
          });
        }
        setTimeout(() => markOnboardingComplete(), 500);
        return;
      }

      if (nextIndex >= hotMarkets.length) {
        if (!stepThreeTrackedRef.current) {
          stepThreeTrackedRef.current = true;
          trackEvent(ANALYTICS_EVENTS.ONBOARDING_STEP_COMPLETED, {
            step: 3,
            cardsSeen: hotMarkets.length,
            betsPlaced: placedBets.length + (resolvedChoice === 'YES' || resolvedChoice === 'NO' ? 1 : 0)
          });
        }
        setTimeout(() => markOnboardingComplete(), 500);
      }
    }, 450);
  }

  function handlePointerDown(event) {
    if (animatingOut || placingBet || !topCard) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-onboarding-action]')) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({ active: true, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 });
  }

  function handlePointerMove(event) {
    if (!dragState.active || animatingOut) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    setDragState((prev) => ({ ...prev, dx, dy }));
  }

  function handlePointerUp() {
    if (!dragState.active || animatingOut) return;
    const { dx, dy } = dragState;
    setDragState({ active: false, startX: 0, startY: 0, dx: 0, dy: 0 });

    if (dx > 80) {
      handleSwipeChoice('YES');
      return;
    }
    if (dx < -80) {
      handleSwipeChoice('NO');
      return;
    }
    if (dy < -60) {
      handleSwipeChoice('SKIP');
      return;
    }
  }

  function progressClass(index) {
    if (index === currentCardIndex && step === 3) return 'active';
    if (index < currentCardIndex) {
      const value = choices[index];
      if (value === 'YES') return 'done';
      if (value === 'NO') return 'done-no';
      return 'skipped';
    }
    return '';
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <p className="font-mono text-[var(--text-muted)]">Loading onboarding...</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen min-h-[100dvh] overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <ToastStack toasts={toasts} onClose={removeToast} onConfirm={resolveConfirm} />

      <main className="absolute inset-0 flex items-center justify-center p-6">
        <section className={`absolute inset-0 flex items-center justify-center p-6 transition-all duration-300 ${step === 1 ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-3 pointer-events-none'}`}>
          <div className="w-full max-w-[480px] text-center">
            <div className="mb-4 text-5xl animate-[popIn_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">🔮</div>
            <h1 className="mb-3 font-display text-[2rem] leading-[1.1] sm:text-[2.6rem]">Welcome to Predict Cornell</h1>
            <p className="mb-6 text-[0.92rem] leading-[1.55] text-[var(--text-dim)]">
              Campus prediction markets. Bet on what happens next at Cornell — courses, sports, construction, and more.
            </p>
            <p className="mb-10 text-[0.82rem] leading-[1.5] text-[var(--text-muted)]">
              You start with <strong className="text-[var(--amber-bright)]">$1,000</strong>. We&apos;ll walk you through your first predictions in under a minute.
            </p>
            <button
              onClick={() => {
                trackEvent(ANALYTICS_EVENTS.ONBOARDING_STEP_COMPLETED, { step: 1 });
                setStep(2);
              }}
              className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--red)] px-10 py-3 font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[var(--red-dim)]"
            >
              Let&apos;s go →
            </button>
          </div>
        </section>

        <section className={`absolute inset-0 flex items-center justify-center p-6 transition-all duration-300 ${step === 2 ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-3 pointer-events-none'}`}>
          <div className="w-full max-w-[440px] text-center">
            <div className="mb-6 flex items-center justify-center gap-2 font-mono text-[0.5rem] uppercase tracking-[0.15em] text-[var(--red)]">
              <span className="h-px w-6 bg-[var(--red)]" />
              Step 01
              <span className="h-px w-6 bg-[var(--red)]" />
            </div>
            <h1 className="mb-2 font-display text-[1.8rem] leading-[1.1] sm:text-[2.4rem]">What should we call you?</h1>
            <p className="mb-10 text-[0.88rem] leading-[1.5] text-[var(--text-dim)]">
              Pick a display name. This is how you&apos;ll appear on the leaderboard and in market comments.
            </p>
            <input
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setNameError('');
              }}
              maxLength={24}
              autoComplete="off"
              spellCheck={false}
              className="mb-2 w-full rounded-[8px] border border-[var(--border2)] bg-[var(--surface)] px-5 py-4 text-center font-mono text-[1.1rem] font-bold text-[var(--text)] outline-none focus:border-[var(--red)]"
              placeholder="your display name"
            />
            <p className="mb-8 font-mono text-[0.55rem] tracking-[0.03em] text-[var(--text-muted)]">
              defaults to your NetID <strong className="text-[var(--text-dim)]">{netId}</strong> · 3-24 chars
            </p>
            {nameError ? <p className="mb-4 text-[0.75rem] text-[var(--red)]">{nameError}</p> : null}
            <button
              onClick={handleNameSubmit}
              disabled={savingName || tutorialLoading}
              className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--red)] px-10 py-3 font-mono text-[0.72rem] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[var(--red-dim)] disabled:opacity-60"
            >
              {savingName || tutorialLoading ? 'Setting up...' : 'Lock it in →'}
            </button>
          </div>
        </section>

        <section className={`absolute inset-0 flex items-center justify-center p-6 transition-all duration-300 ${step === 3 ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-3 pointer-events-none'}`}>
          <div className="w-full max-w-[400px]">
            <div className="mb-6 text-center">
              <h2 className="mb-1 font-display text-[1.6rem]">Five Futures</h2>
              <p className="font-mono text-[0.55rem] tracking-[0.06em] text-[var(--text-muted)]">Five featured questions. Swipe right for yes, left for no, up to skip.</p>
            </div>

            <div className="mb-5 flex justify-center gap-[6px]">
              {hotMarkets.map((_, index) => {
                const cls = progressClass(index);
                return (
                  <span
                    key={index}
                    className={`h-2 w-2 rounded-full border transition-all duration-200 ${
                      cls === 'active'
                        ? 'scale-110 border-[var(--red)] bg-[var(--red)]'
                        : cls === 'done'
                          ? 'border-[var(--green-bright)] bg-[var(--green-bright)]'
                          : cls === 'done-no'
                            ? 'border-[var(--red)] bg-[var(--red)]'
                            : cls === 'skipped'
                              ? 'border-[var(--text-muted)] bg-[var(--text-muted)]'
                              : 'border-[var(--border2)] bg-[var(--surface3)]'
                    }`}
                  />
                );
              })}
            </div>

            <p className="mb-5 text-center font-mono text-[0.55rem] tracking-[0.04em] text-[var(--text-muted)]">
              each bet: <strong className="text-[var(--amber-bright)]">${betAmount}</strong> from your ${Math.round(remainingBalance).toLocaleString()} wallet
            </p>

            <div className="relative mb-4 h-[340px] sm:h-[380px]">
              {hotMarkets.slice(currentCardIndex, currentCardIndex + 3).reverse().map((market, reverseIdx, visibleSlice) => {
                const idx = currentCardIndex + (visibleSlice.length - 1 - reverseIdx);
                const isTop = idx === currentCardIndex;
                const behindClass = isTop ? '' : idx === currentCardIndex + 1 ? 'scale-[0.95] translate-y-[12px] opacity-60' : 'scale-[0.90] translate-y-[24px] opacity-30';
                const probability = Number(market.probability || 0.5);
                const pct = Math.round(probability * 100);
                const yesOpacity = isTop ? Math.max(0, Math.min(1, dragState.dx / 120)) : 0;
                const noOpacity = isTop ? Math.max(0, Math.min(1, -dragState.dx / 120)) : 0;
                const skipOpacity = isTop ? Math.max(0, Math.min(1, -dragState.dy / 90)) : 0;
                const cardCategory = categoryMeta(market.category);

                const dynamicStyle = isTop
                  ? exitDirection === 'right'
                    ? { transform: 'translateX(120%) rotate(12deg)', opacity: 0 }
                    : exitDirection === 'left'
                      ? { transform: 'translateX(-120%) rotate(-12deg)', opacity: 0 }
                      : exitDirection === 'up'
                        ? { transform: 'translateY(-100%) scale(0.9)', opacity: 0 }
                        : dragState.active
                          ? { transform: `translate(${dragState.dx}px, ${Math.min(dragState.dy, 0)}px) rotate(${dragState.dx * 0.08}deg)` }
                          : {}
                  : {};
                const cardStyle = isTop ? { ...dynamicStyle, touchAction: 'none' } : dynamicStyle;

                return (
                  <div
                    key={market.id}
                    className={`absolute inset-0 flex flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)] transition-all duration-[450ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] ${behindClass}`}
                    onPointerDown={isTop ? handlePointerDown : undefined}
                    onPointerMove={isTop ? handlePointerMove : undefined}
                    onPointerUp={isTop ? handlePointerUp : undefined}
                    onPointerCancel={isTop ? handlePointerUp : undefined}
                    style={cardStyle}
                  >
                    <div className="pointer-events-none absolute left-5 top-1/2 z-10 -translate-y-1/2 rounded-[6px] border-[2.5px] border-[var(--red)] bg-[rgba(220,38,38,0.08)] px-5 py-2 font-mono text-[1.4rem] font-bold uppercase tracking-[0.06em] text-[var(--red)]" style={{ opacity: noOpacity }}>
                      ← No
                    </div>
                    <div className="pointer-events-none absolute right-5 top-1/2 z-10 -translate-y-1/2 rounded-[6px] border-[2.5px] border-[var(--green-bright)] bg-[rgba(34,197,94,0.08)] px-5 py-2 font-mono text-[1.4rem] font-bold uppercase tracking-[0.06em] text-[var(--green-bright)]" style={{ opacity: yesOpacity }}>
                      Yes →
                    </div>
                    <div className="pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2 rounded-[6px] border-[2.5px] border-[var(--text-muted)] bg-[rgba(61,59,56,0.15)] px-4 py-1 font-mono text-[0.9rem] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]" style={{ opacity: skipOpacity }}>
                      Skip ↑
                    </div>

                    <div className="flex items-center justify-between px-5 pt-4">
                      <span className="rounded-[3px] border border-[var(--border2)] bg-[var(--surface3)] px-[0.55rem] py-[0.2rem] font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        {cardCategory.emoji} {cardCategory.label}
                      </span>
                      <span className="font-mono text-[0.5rem] tracking-[0.04em] text-[var(--text-muted)]">
                        <strong className="text-[var(--amber-bright)]">${Math.round(market.totalVolume || 0).toLocaleString()}</strong> traded
                      </span>
                    </div>

                    <div className="flex flex-1 items-center justify-center px-7 text-center">
                      <h3 className="font-display text-[1.25rem] leading-[1.25] sm:text-[1.55rem]">{market.question}</h3>
                    </div>

                    <div className="mb-3 px-5">
                      <div className="mb-2 h-[6px] overflow-hidden rounded-[3px] bg-[var(--surface3)]">
                        <div className="h-full rounded-[3px] transition-all duration-300" style={{ width: `${pct}%`, background: probabilityColor(probability) }} />
                      </div>
                      <div className="flex justify-between">
                        <span className="font-mono text-[0.6rem] font-bold" style={{ color: probabilityColor(1 - probability) }}>{100 - pct}% No</span>
                        <span className="font-mono text-[0.6rem] font-bold" style={{ color: probabilityColor(probability) }}>{pct}% Yes</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto_1fr] border-t border-[var(--border)] bg-[var(--surface2)]">
                      <button
                        type="button"
                        data-onboarding-action="no"
                        className="flex min-h-12 flex-col items-center justify-center gap-1 border-r border-[var(--border)] hover:bg-[var(--surface3)]"
                        onClick={() => handleSwipeChoice('NO')}
                      >
                        <span className="text-xl text-[var(--red)]">✗</span>
                        <span className="font-mono text-[0.48rem] uppercase tracking-[0.1em] text-[var(--red)]">Bet No</span>
                      </button>
                      <button
                        type="button"
                        data-onboarding-action="skip"
                        className="flex min-h-12 flex-col items-center justify-center gap-1 px-4 hover:bg-[var(--surface3)]"
                        onClick={() => handleSwipeChoice('SKIP')}
                      >
                        <span className="text-xl text-[var(--text-muted)]">↑</span>
                        <span className="font-mono text-[0.48rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Skip</span>
                      </button>
                      <button
                        type="button"
                        data-onboarding-action="yes"
                        className="flex min-h-12 flex-col items-center justify-center gap-1 border-l border-[var(--border)] hover:bg-[var(--surface3)]"
                        onClick={() => handleSwipeChoice('YES')}
                      >
                        <span className="text-xl text-[var(--green-bright)]">✓</span>
                        <span className="font-mono text-[0.48rem] uppercase tracking-[0.1em] text-[var(--green-bright)]">Bet Yes</span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {hotMarkets.length === 0 || tutorialLoading ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface)] font-mono text-[0.72rem] text-[var(--text-muted)]">
                  {tutorialLoading ? 'Loading hot markets...' : 'No open markets available.'}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-center gap-8 font-mono text-[0.52rem] uppercase tracking-[0.06em] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--red)]" />← No</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--text-muted)]" />↑ Skip</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-[5px] w-[5px] rounded-full bg-[var(--green-bright)]" />Yes →</span>
            </div>
            <p className="mt-2 text-center font-mono text-[0.5rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Swipe the card or tap a decision button
            </p>
          </div>
        </section>

      </main>
    </div>
  );
}
