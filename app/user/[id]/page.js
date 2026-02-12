'use client';
import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getPublicDisplayName } from '@/utils/displayName';
import { MARKET_STATUS, getMarketStatus } from '@/utils/marketStatus';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

function fmtMoney(num) {
  return Number(num || 0).toFixed(2);
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

export default function UserProfilePage() {
  const { id } = useParams();
  const [viewer, setViewer] = useState(null);
  const [user, setUser] = useState(null);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setViewer(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function fetchUserProfile() {
      try {
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
        console.error('Error fetching user profile:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchUserProfile();
  }, [id]);

  const activePositions = useMemo(
    () => bets.filter((bet) => [MARKET_STATUS.OPEN, MARKET_STATUS.LOCKED].includes(bet.marketStatus)),
    [bets]
  );

  const closedPositions = useMemo(
    () => bets.filter((bet) => [MARKET_STATUS.RESOLVED, MARKET_STATUS.CANCELLED].includes(bet.marketStatus)),
    [bets]
  );

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
  const lifetimeNet = Number(user.lifetimeRep || 0);

  return (
    <div className="p-8 max-w-4xl mx-auto bg-[var(--bg)] min-h-screen">
      <div className="mb-8">
        <h1 className="mb-2 font-display text-5xl leading-[1.05] tracking-[-0.02em] text-[var(--text)]">{username}&apos;s Profile</h1>
        {viewerIsAdmin && user.email && <p className="text-[var(--text-dim)]">{user.email}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 mb-8">
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Total Bets</p>
          <p className="font-mono text-lg text-[var(--text)]">{bets.length}</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Profit / Loss</p>
          <p className={`font-mono text-lg ${lifetimeNet >= 0 ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
            {lifetimeNet >= 0 ? '+' : '-'}${fmtMoney(Math.abs(lifetimeNet))}
          </p>
          <p className="font-mono text-[0.62rem] text-[var(--text-dim)]">Week: {weeklyNet >= 0 ? '+' : '-'}${fmtMoney(Math.abs(weeklyNet))}</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--text-muted)]">Rank</p>
          <p className="font-mono text-lg text-[var(--amber-bright)]">{user.rank ? `#${user.rank}` : 'N/A'}</p>
        </div>
      </div>

      <PositionSection title={`Active Positions (${activePositions.length})`} bets={activePositions} emptyLabel="No active positions yet." />

      <div className="h-6" />

      <PositionSection title={`Closed Positions (${closedPositions.length})`} bets={closedPositions} emptyLabel="No closed positions yet." />
    </div>
  );
}

function PositionSection({ title, bets, emptyLabel }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg border border-[var(--border)] p-6">
      <h2 className="text-xl font-semibold mb-4 text-[var(--text)]">{title}</h2>

      {bets.length === 0 ? (
        <p className="text-[var(--text-muted)]">{emptyLabel}</p>
      ) : (
        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          {bets.map((bet) => (
            <Link key={bet.id} href={`/market/${bet.marketId}`} className="block border-b border-[var(--border)] p-4 transition-colors last:border-b-0 hover:bg-[var(--surface2)]">
              <div className="flex justify-between items-start mb-2 gap-3">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-[0.72rem] uppercase tracking-[0.08em] font-bold ${bet.side === 'YES' ? 'text-[var(--green-bright)]' : 'text-[var(--red)]'}`}>
                    {bet.side}
                  </span>
                  <span className="px-2 py-1 rounded-full text-xs font-semibold bg-[var(--surface2)] text-[var(--text-dim)] border border-[var(--border2)]">
                    {bet.marketStatus}
                  </span>
                </div>
                <span className="font-mono text-[0.68rem] text-[var(--text-muted)]">
                  {bet.timestamp?.toDate?.()?.toLocaleDateString() || 'Recently'}
                </span>
              </div>
              <p className="font-medium text-[var(--text)] mb-2">{bet.marketQuestion || 'Loading...'}</p>
              <p className="text-[var(--text)] mb-1">Amount: <span className="font-semibold">${fmtMoney(Math.abs(bet.amount || 0))}</span></p>
              <p className="text-sm text-[var(--text-dim)]">Shares: {round2(Math.abs(bet.shares || 0))}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
