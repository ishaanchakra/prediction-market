'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

function initialsFor(user) {
  if (!user?.email) return 'PC';
  const prefix = user.email.split('@')[0];
  const parts = prefix.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return prefix.slice(0, 2).toUpperCase();
}

export default function Navigation() {
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [balance, setBalance] = useState(0);
  const router = useRouter();

  const isAdmin = useMemo(() => !!(user?.email && ADMIN_EMAILS.includes(user.email)), [user]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        try {
          const unreadQuery = query(
            collection(db, 'notifications'),
            where('userId', '==', currentUser.uid),
            where('read', '==', false)
          );
          const unreadSnapshot = await getDocs(unreadQuery);
          setUnreadCount(unreadSnapshot.size);

          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          setBalance(userDoc.exists() ? Number(userDoc.data().weeklyRep || 0) : 0);
        } catch (error) {
          console.error('Error fetching nav state:', error);
        }
      } else {
        setUnreadCount(0);
        setBalance(0);
      }
    });

    return () => unsubscribe();
  }, []);

  async function handleLogout() {
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }

  return (
    <nav className="sticky top-0 z-50 grid h-14 grid-cols-[1fr_auto_1fr] items-center border-b border-[var(--border)] bg-[rgba(8,8,8,0.92)] px-8 backdrop-blur-[16px]">
      <Link href="/" className="justify-self-start flex items-center gap-2 no-underline">
        <span className="dot-pulse h-[7px] w-[7px] rounded-full bg-[var(--red)] shadow-[0_0_6px_var(--red)]" />
        <span className="font-sans text-base font-extrabold tracking-[-0.025em] text-[var(--text)]">
          Predict <em className="not-italic text-[var(--red)]">Cornell</em>
        </span>
      </Link>

      <ul className="justify-self-center flex list-none items-center gap-[0.15rem]">
        <li>
          <Link href="/markets/active" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
            Markets
          </Link>
        </li>
        <li>
          <Link href="/leaderboard" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
            Leaderboard
          </Link>
        </li>
        <li>
          <Link href="/call-for-markets" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
            Call for Markets
          </Link>
        </li>
        <li>
          <Link href="/how-it-works" className="rounded px-[0.7rem] py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text)]">
            How It Works
          </Link>
        </li>
      </ul>

      <div className="justify-self-end flex items-center gap-3">
        {user && (
          <>
            <div className="flex items-center gap-2 rounded border border-[var(--border2)] px-3 py-[0.3rem] font-mono text-[0.7rem] text-[var(--text-dim)]">
              balance
              <strong className="text-[0.8rem] text-[var(--amber-bright)]">
                ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            </div>
            <Link href="/notifications" className="rounded border border-[var(--border)] px-2 py-1 font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:text-[var(--text)]">
              N{unreadCount > 0 ? `:${unreadCount}` : ''}
            </Link>
            <Link href="/profile" className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border2)] bg-[var(--red-glow)] font-mono text-[0.6rem] font-bold text-[var(--red)]">
              {initialsFor(user)}
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--red)] px-1 text-[9px] font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </Link>
            {isAdmin && (
              <Link href="/admin" className="rounded px-[0.5rem] py-[0.25rem] font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]">
                Admin
              </Link>
            )}
            <button onClick={handleLogout} className="rounded px-[0.5rem] py-[0.25rem] font-mono text-[0.58rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]">
              Logout
            </button>
          </>
        )}
        {!user && (
          <Link href="/login" className="rounded border border-[var(--border2)] px-3 py-[0.35rem] font-mono text-[0.62rem] uppercase tracking-[0.06em] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]">
            Sign In
          </Link>
        )}
      </div>
    </nav>
  );
}
