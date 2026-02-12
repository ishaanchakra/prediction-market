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

  if (loading) return <div className="p-8 bg-brand-red dark:bg-slate-950 text-white min-h-screen">Loading...</div>;
  if (notFound) {
    return (
      <div className="p-8 max-w-4xl mx-auto bg-brand-red dark:bg-slate-950 min-h-screen">
        <h1 className="text-3xl font-bold mb-2 text-white">User Not Found</h1>
        <p className="text-white opacity-90">This user does not exist.</p>
        <Link href="/leaderboard" className="text-white underline mt-4 inline-block">Back to Leaderboard</Link>
      </div>
    );
  }
  if (!user) return null;

  const username = getPublicDisplayName({ id, ...user });
  const viewerIsAdmin = !!viewer?.email && ADMIN_EMAILS.includes(viewer.email);

  return (
    <div className="p-8 max-w-4xl mx-auto bg-brand-red dark:bg-slate-950 min-h-screen">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 text-white">{username}&apos;s Profile</h1>
        {viewerIsAdmin && user.email && <p className="text-white opacity-90">{user.email}</p>}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gradient-to-br from-brand-red to-brand-darkred rounded-lg p-6 text-white border-2 border-white">
          <p className="text-sm opacity-90 mb-1">Balance</p>
          <p className="text-4xl font-bold">${fmtMoney(user.weeklyRep)}</p>
          <p className="text-sm opacity-75 mt-2">Resets every Monday</p>
        </div>

        <div className="bg-gradient-to-br from-brand-pink to-brand-red rounded-lg p-6 text-white border-2 border-white">
          <p className="text-sm opacity-90 mb-1">Lifetime Earnings</p>
          <p className="text-4xl font-bold">${fmtMoney(user.lifetimeRep)}</p>
          <p className="text-sm opacity-75 mt-2">Net winnings over all time</p>
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
    <div className="bg-white dark:bg-slate-900 rounded-lg border-2 border-brand-pink dark:border-slate-700 p-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">{title}</h2>

      {bets.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-300">{emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {bets.map((bet) => (
            <Link key={bet.id} href={`/market/${bet.marketId}`} className="block border-2 border-gray-200 dark:border-slate-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-slate-800 hover:border-brand-pink transition-colors">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${bet.side === 'YES' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {bet.side}
                  </span>
                  <span className="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-200">
                    {bet.marketStatus}
                  </span>
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-300">
                  {bet.timestamp?.toDate?.()?.toLocaleDateString() || 'Recently'}
                </span>
              </div>
              <p className="font-medium text-gray-900 dark:text-gray-100 mb-2">{bet.marketQuestion || 'Loading...'}</p>
              <p className="text-gray-900 dark:text-gray-100 mb-1">Amount: <span className="font-semibold">${fmtMoney(Math.abs(bet.amount || 0))}</span></p>
              <p className="text-sm text-gray-600 dark:text-gray-300">Shares: {round2(Math.abs(bet.shares || 0))}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
