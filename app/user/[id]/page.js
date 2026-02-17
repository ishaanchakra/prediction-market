'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getPublicDisplayName } from '@/utils/displayName';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';
import PortfolioView from '@/app/components/PortfolioView';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

function fmtMoney(num) {
  return Number(num || 0).toFixed(2);
}

export default function UserProfilePage() {
  const { id } = useParams();
  const [viewer, setViewer] = useState(null);
  const [user, setUser] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setViewer(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchUserProfile() {
      try {
        setProfileError('');
        const userDoc = await getDoc(doc(db, 'users', id));
        if (!userDoc.exists()) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setUser({ uid: id, ...userDoc.data() });

        const betsQuery = query(collection(db, 'bets'), where('userId', '==', id));
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
      } catch (error) {
        console.error('Error fetching user profile:', error);
        setProfileError('Unable to load this user profile right now.');
      } finally {
        setLoading(false);
      }
    }
    fetchUserProfile();
  }, [id]);

  if (loading) return <div className="p-8 bg-[var(--bg)] text-[var(--text-muted)] font-mono min-h-screen text-center">Loading...</div>;
  if (notFound) {
    return (
      <div className="p-8 max-w-4xl mx-auto bg-[var(--bg)] min-h-screen">
        <h1 className="font-display text-5xl leading-[1.05] tracking-[-0.02em] mb-2 text-[var(--text)]">User Not Found</h1>
        <p className="text-[var(--text-dim)]">This user does not exist.</p>
        <Link href="/leaderboard" className="text-[var(--text)] underline mt-4 inline-block">Back to Leaderboard</Link>
      </div>
    );
  }
  if (!user) return null;

  const username = getPublicDisplayName({ id, ...user });
  const viewerIsAdmin = !!viewer?.email && ADMIN_EMAILS.includes(viewer.email);
  const weeklyNet = Number(user.weeklyRep || 0) - 1000;

  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        {profileError && (
          <div className="mb-4 rounded border border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.08)] px-4 py-2 font-mono text-[0.65rem] text-[#f59e0b]">
            {profileError}
          </div>
        )}

        <div className="mb-8 border-b border-[var(--border)] pb-6">
          <h1 className="mb-2 font-display text-[2rem] leading-[1.2] text-[var(--text)]">{username}&apos;s Profile</h1>
          {viewerIsAdmin && user.email && <p className="font-mono text-[0.62rem] text-[var(--text-dim)]">{user.email}</p>}
        </div>

        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center sm:text-left">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Weekly Balance</p>
            <p className="font-mono text-[2.5rem] font-bold leading-none text-[var(--amber-bright)]">${fmtMoney(user.weeklyRep)}</p>
            <p className="mt-2 font-mono text-[0.6rem] text-[var(--text-muted)]">Resets every Monday</p>
          </div>
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-6 text-center sm:text-left">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Lifetime Earnings</p>
            <p className="font-mono text-[2.5rem] font-bold leading-none text-[var(--amber-bright)]">${fmtMoney(user.lifetimeRep)}</p>
            <p className="mt-2 font-mono text-[0.6rem] text-[var(--text-muted)]">
              Cumulative resolved-market net · Week: {weeklyNet >= 0 ? '+' : '-'}${fmtMoney(Math.abs(weeklyNet))}
            </p>
          </div>
        </div>

        <PortfolioView
          userId={id}
          user={user}
          bets={bets}
          isOwnProfile={false}
        />
      </div>
    </div>
  );
}
