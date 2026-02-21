'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import ToastStack from '@/app/components/ToastStack';
import useToastQueue from '@/app/hooks/useToastQueue';
import {
  MARKETPLACE_DEFAULTS,
  MARKETPLACE_RESET_MODE,
  MARKETPLACE_ROLE,
  nextWeeklyResetDate,
  slugifyMarketplaceName,
  toMarketplaceMemberId
} from '@/utils/marketplace';
import {
  createMarketplaceJoinProof,
  createMarketplacePasswordSecret
} from '@/utils/marketplaceAuth';
import { ANALYTICS_EVENTS, trackEvent } from '@/utils/analytics';

const INPUT_CLASS =
  'w-full rounded border border-[var(--border2)] bg-[var(--surface2)] px-3 py-2 font-mono text-[0.78rem] text-[var(--text)] focus:outline-none focus:border-[var(--red)]';

function EnterMarketplaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toasts, notifyError, notifySuccess, removeToast, resolveConfirm } = useToastQueue();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joinedMarketplaces, setJoinedMarketplaces] = useState([]);
  const [availableMarketplaces, setAvailableMarketplaces] = useState([]);
  const [availableSearch, setAvailableSearch] = useState('');
  const [selectedMarketplaceId, setSelectedMarketplaceId] = useState('');

  const [joinIdentifier, setJoinIdentifier] = useState('');
  const [joinPassword, setJoinPassword] = useState('');

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [startingBalance, setStartingBalance] = useState(MARKETPLACE_DEFAULTS.startingBalance);
  const [defaultB, setDefaultB] = useState(MARKETPLACE_DEFAULTS.defaultB);
  const [resetMode, setResetMode] = useState(MARKETPLACE_DEFAULTS.resetMode);

  const requestedMarketplaceId = searchParams.get('marketplace');

  const canCreate = useMemo(() => {
    return name.trim().length >= 3 && password.length >= 4 && Number(startingBalance) > 0 && Number(defaultB) > 0;
  }, [name, password, startingBalance, defaultB]);
  const joinedByMarketplaceId = useMemo(() => {
    const map = new Map();
    joinedMarketplaces.forEach((row) => {
      if (row?.marketplace?.id) map.set(row.marketplace.id, row);
    });
    return map;
  }, [joinedMarketplaces]);
  const selectedMarketplace = useMemo(
    () => availableMarketplaces.find((marketplace) => marketplace.id === selectedMarketplaceId) || null,
    [availableMarketplaces, selectedMarketplaceId]
  );
  const filteredMarketplaces = useMemo(() => {
    const needle = availableSearch.trim().toLowerCase();
    const visible = availableMarketplaces.filter((marketplace) => !marketplace.isArchived);
    if (!needle) return visible;
    return visible.filter((marketplace) =>
      String(marketplace.name || '').toLowerCase().includes(needle)
      || String(marketplace.slug || '').toLowerCase().includes(needle)
    );
  }, [availableMarketplaces, availableSearch]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }
      setUser(currentUser);
      try {
        await Promise.all([
          fetchJoinedMarketplaces(currentUser.uid),
          fetchAvailableMarketplaces()
        ]);
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!requestedMarketplaceId) return;
    const normalized = requestedMarketplaceId.trim().toLowerCase();
    setJoinIdentifier(requestedMarketplaceId);
    const matched = availableMarketplaces.find((marketplace) =>
      marketplace.id === requestedMarketplaceId
      || String(marketplace.slug || '').toLowerCase() === normalized
      || String(marketplace.nameLower || '').toLowerCase() === normalized
    );
    if (matched) {
      setSelectedMarketplaceId(matched.id);
    }
  }, [requestedMarketplaceId, availableMarketplaces]);

  async function fetchJoinedMarketplaces(userId) {
    const membersQ = query(
      collection(db, 'marketplaceMembers'),
      where('userId', '==', userId),
      orderBy('joinedAt', 'desc'),
      limit(50)
    );
    const membersSnap = await getDocs(membersQ);
    const membershipRows = membersSnap.docs.map((snapshotDoc) => snapshotDoc.data());
    const marketplaceDocs = await Promise.all(
      membershipRows.map(async (member) => {
        const marketplaceSnap = await getDoc(doc(db, 'marketplaces', member.marketplaceId));
        if (!marketplaceSnap.exists()) return null;
        return {
          ...member,
          marketplace: { id: marketplaceSnap.id, ...marketplaceSnap.data() }
        };
      })
    );
    setJoinedMarketplaces(marketplaceDocs.filter(Boolean));
  }

  async function fetchAvailableMarketplaces() {
    const marketplacesSnap = await getDocs(query(collection(db, 'marketplaces'), limit(300)));
    const rows = marketplacesSnap.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
      .filter((marketplace) => !marketplace.isArchived)
      .sort((a, b) => {
        const aLabel = String(a.nameLower || a.name || a.slug || '').toLowerCase();
        const bLabel = String(b.nameLower || b.name || b.slug || '').toLowerCase();
        return aLabel.localeCompare(bLabel);
      });
    setAvailableMarketplaces(rows);
  }

  async function findMarketplace(identifier) {
    const normalized = identifier.trim().toLowerCase();
    if (!normalized) return null;

    const idSnap = await getDoc(doc(db, 'marketplaces', identifier.trim()));
    if (idSnap.exists()) {
      return { id: idSnap.id, ...idSnap.data() };
    }

    const slugQuery = query(collection(db, 'marketplaces'), where('slug', '==', normalized), limit(1));
    const slugSnap = await getDocs(slugQuery);
    if (!slugSnap.empty) {
      return { id: slugSnap.docs[0].id, ...slugSnap.docs[0].data() };
    }

    const nameQuery = query(collection(db, 'marketplaces'), where('nameLower', '==', normalized), limit(1));
    const nameSnap = await getDocs(nameQuery);
    if (!nameSnap.empty) {
      return { id: nameSnap.docs[0].id, ...nameSnap.docs[0].data() };
    }
    return null;
  }

  async function handleJoinMarketplace(e) {
    e.preventDefault();
    if (!user) return;
    if (!joinPassword) {
      notifyError('Enter the marketplace password.');
      return;
    }

    setJoining(true);
    try {
      const marketplace = selectedMarketplace || await findMarketplace(joinIdentifier);
      if (!marketplace || marketplace.isArchived) {
        notifyError('Marketplace not found.');
        return;
      }
      trackEvent(ANALYTICS_EVENTS.MARKETPLACE_JOIN_STARTED, {
        marketplaceId: marketplace.id,
        marketplaceSlug: marketplace.slug || null
      });

      const memberId = toMarketplaceMemberId(marketplace.id, user.uid);
      const memberRef = doc(db, 'marketplaceMembers', memberId);
      const existingMember = await getDoc(memberRef);
      if (existingMember.exists()) {
        router.push(`/marketplace/${marketplace.id}`);
        return;
      }

      const joinProofHash = await createMarketplaceJoinProof(joinPassword, marketplace.passwordSalt || '');
      await setDoc(memberRef, {
        marketplaceId: marketplace.id,
        userId: user.uid,
        role: MARKETPLACE_ROLE.MEMBER,
        balance: Number(marketplace.startingBalance || MARKETPLACE_DEFAULTS.startingBalance),
        lifetimeRep: 0,
        joinedAt: new Date(),
        updatedAt: new Date(),
        joinProofHash
      });

      notifySuccess(`Joined ${marketplace.name}.`);
      trackEvent(ANALYTICS_EVENTS.MARKETPLACE_JOIN_COMPLETED, {
        marketplaceId: marketplace.id,
        marketplaceSlug: marketplace.slug || null
      });
      await fetchJoinedMarketplaces(user.uid);
      setJoinPassword('');
      router.push(`/marketplace/${marketplace.id}`);
    } catch (error) {
      console.error('Error joining marketplace:', error);
      notifyError('Unable to join marketplace. Check password and try again.');
    } finally {
      setJoining(false);
    }
  }

  async function handleCreateMarketplace(e) {
    e.preventDefault();
    if (!user || !canCreate) return;

    setCreating(true);
    try {
      const normalizedName = name.trim();
      const slugBase = slugifyMarketplaceName(normalizedName);
      let slug = slugBase;

      let duplicateIndex = 1;
      while (true) {
        const dupSnap = await getDocs(query(collection(db, 'marketplaces'), where('slug', '==', slug), limit(1)));
        if (dupSnap.empty) break;
        duplicateIndex += 1;
        slug = `${slugBase}-${duplicateIndex}`;
      }

      const { passwordSalt, passwordHash } = await createMarketplacePasswordSecret(password);
      const now = new Date();
      const nextResetAt = resetMode === MARKETPLACE_RESET_MODE.WEEKLY ? nextWeeklyResetDate(now) : null;

      const marketplaceRef = await addDoc(collection(db, 'marketplaces'), {
        name: normalizedName,
        nameLower: normalizedName.toLowerCase(),
        slug,
        creatorUserId: user.uid,
        startingBalance: Number(startingBalance),
        defaultB: Number(defaultB),
        resetMode,
        nextResetAt,
        lastResetAt: null,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        passwordSalt
      });

      await setDoc(doc(db, 'marketplaceSecrets', marketplaceRef.id), {
        passwordHash,
        passwordSalt,
        creatorUserId: user.uid,
        updatedAt: now
      });

      await setDoc(doc(db, 'marketplaceMembers', toMarketplaceMemberId(marketplaceRef.id, user.uid)), {
        marketplaceId: marketplaceRef.id,
        userId: user.uid,
        role: MARKETPLACE_ROLE.CREATOR,
        balance: Number(startingBalance),
        lifetimeRep: 0,
        joinedAt: now,
        updatedAt: now,
        joinProofHash: passwordHash
      });

      notifySuccess('Marketplace created.');
      router.push(`/marketplace/${marketplaceRef.id}`);
    } catch (error) {
      console.error('Error creating marketplace:', error);
      notifyError('Unable to create marketplace right now.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <p className="font-mono text-[var(--text-muted)]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-8 md:px-8 md:py-12">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-8">
          <p className="mb-3 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--red)]">
            <span className="inline-block h-px w-5 bg-[var(--red)]" />
            Enter Marketplace
          </p>
          <h1 className="font-display text-[2.2rem] leading-[1.05] text-[var(--text)]">
            Private Prediction Communities
          </h1>
          <p className="mt-2 max-w-[760px] text-[0.9rem] text-[var(--text-dim)]">
            Join or create a password-protected marketplace for your club, team, or student org. Each marketplace has its own wallet, markets, and leaderboard.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={handleJoinMarketplace} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Join Marketplace</p>
            <div className="space-y-3">
              <input
                value={availableSearch}
                onChange={(e) => setAvailableSearch(e.target.value)}
                className={INPUT_CLASS}
                placeholder="Search marketplace name or slug"
                aria-label="Search marketplaces"
              />
              <div className="overflow-hidden rounded border border-[var(--border)] bg-[#040404]">
                <div className="border-b border-[var(--border)] px-3 py-2 font-mono text-[0.56rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Marketplace Terminal · {filteredMarketplaces.length} listed
                </div>
                <div className="max-h-[260px] overflow-y-auto">
                  {filteredMarketplaces.length === 0 ? (
                    <p className="px-3 py-3 font-mono text-[0.66rem] text-[var(--text-muted)]">
                      No marketplaces match that search.
                    </p>
                  ) : (
                    filteredMarketplaces.map((marketplace, index) => {
                      const joinedRow = joinedByMarketplaceId.get(marketplace.id);
                      const selected = selectedMarketplaceId === marketplace.id;
                      return (
                        <button
                          key={marketplace.id}
                          type="button"
                          onClick={() => {
                            setSelectedMarketplaceId(marketplace.id);
                            setJoinIdentifier(marketplace.slug || marketplace.id);
                          }}
                          className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-left font-mono text-[0.64rem] last:border-b-0 ${
                            selected
                              ? 'bg-[rgba(220,38,38,0.12)] text-[var(--text)]'
                              : 'text-[var(--text-dim)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                          }`}
                        >
                          <span className="text-[var(--text-muted)]">{String(index + 1).padStart(2, '0')}</span>
                          <span className="truncate">
                            <span className="block truncate">
                              {marketplace.name}
                              <span className="ml-2 text-[0.58rem] text-[var(--text-muted)]">/{marketplace.slug || marketplace.id}</span>
                            </span>
                            <span className="mt-0.5 block text-[0.54rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                              Password-protected marketplace
                            </span>
                          </span>
                          {joinedRow ? (
                            <span className="rounded border border-[rgba(22,163,74,0.25)] bg-[rgba(22,163,74,0.12)] px-1.5 py-[0.1rem] text-[0.52rem] uppercase tracking-[0.08em] text-[var(--green-bright)]">
                              {joinedRow.role === MARKETPLACE_ROLE.CREATOR ? 'Creator' : 'Joined'}
                            </span>
                          ) : (
                            <span className="text-[0.54rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">open</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              {selectedMarketplace ? (
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Selected: <span className="text-[var(--text)]">{selectedMarketplace.name}</span>
                </p>
              ) : joinIdentifier ? (
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Invite Target: <span className="text-[var(--text)]">{joinIdentifier}</span>
                </p>
              ) : (
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Select a marketplace above, then enter password.
                </p>
              )}
              <input
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                className={INPUT_CLASS}
                placeholder="Marketplace password"
              />
              <button
                type="submit"
                disabled={joining}
                className="rounded border border-[var(--red-dim)] bg-[var(--red)] px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-white hover:bg-[var(--red-dim)] disabled:opacity-60"
              >
                {joining ? 'Joining...' : 'Join Marketplace →'}
              </button>
            </div>
          </form>

          <form onSubmit={handleCreateMarketplace} className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--text-muted)]">Create Marketplace</p>
            <div className="space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT_CLASS}
                placeholder="your marketplace's name"
                maxLength={72}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_CLASS}
                placeholder="Set marketplace password"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Starting Balance</p>
                  <input
                    type="number"
                    min={50}
                    step={50}
                    value={startingBalance}
                    onChange={(e) => setStartingBalance(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Default b</p>
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={defaultB}
                    onChange={(e) => setDefaultB(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
              <div>
                <p className="mb-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Reset Mode</p>
                <select
                  value={resetMode}
                  onChange={(e) => setResetMode(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value={MARKETPLACE_RESET_MODE.WEEKLY}>Weekly</option>
                  <option value={MARKETPLACE_RESET_MODE.MANUAL}>Manual</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={!canCreate || creating}
                className="rounded border border-[var(--red-dim)] bg-[var(--red)] px-4 py-2 font-mono text-[0.68rem] uppercase tracking-[0.08em] text-white hover:bg-[var(--red-dim)] disabled:opacity-60"
              >
                {creating ? 'Creating...' : 'Create Marketplace →'}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-8 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="mb-3 flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <span className="inline-block h-px w-4 bg-[var(--red)]" />
            Joined Marketplaces
          </p>
          {joinedMarketplaces.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">You haven&apos;t joined any marketplaces yet.</p>
          ) : (
            <div className="space-y-2">
              {joinedMarketplaces.map((row) => (
                <Link
                  key={row.marketplace.id}
                  href={`/marketplace/${row.marketplace.id}`}
                  className="flex items-center justify-between rounded border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 hover:border-[var(--border2)]"
                >
                  <div>
                    <p className="text-sm font-semibold text-[var(--text)]">{row.marketplace.name}</p>
                    <p className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {row.role === MARKETPLACE_ROLE.CREATOR ? 'Creator' : 'Member'}
                    </p>
                  </div>
                  <span className="font-mono text-[0.75rem] text-[var(--amber-bright)]">
                    ${Number(row.balance || 0).toFixed(2)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <ToastStack toasts={toasts} onDismiss={removeToast} onConfirm={resolveConfirm} />
    </div>
  );
}

export default function EnterMarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
          <p className="font-mono text-[var(--text-muted)]">Loading...</p>
        </div>
      }
    >
      <EnterMarketplaceContent />
    </Suspense>
  );
}
