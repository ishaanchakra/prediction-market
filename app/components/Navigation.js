'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { auth, db } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { collection, query, where, getDocs } from 'firebase/firestore';

const ADMIN_EMAILS = ['ichakravorty14@gmail.com', 'ic367@cornell.edu'];

export default function Navigation() {
  const [user, setUser] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showMarketsDropdown, setShowMarketsDropdown] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        try {
          const q = query(
            collection(db, 'notifications'),
            where('userId', '==', currentUser.uid),
            where('read', '==', false)
          );
          const snapshot = await getDocs(q);
          setUnreadCount(snapshot.size);
        } catch (error) {
          console.error('Error fetching notifications:', error);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push('/login');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="text-xl font-bold text-brand-red hover:text-brand-darkred transition-colors">
              Predict Cornell
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {/* Markets dropdown - visible to all users */}
            <div
              className="relative"
              onMouseEnter={() => setShowMarketsDropdown(true)}
              onMouseLeave={() => setShowMarketsDropdown(false)}
            >
              <button className="text-gray-700 hover:text-brand-red px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1">
                Markets
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showMarketsDropdown && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-50">
                  <Link
                    href="/markets/active"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-red-50 hover:text-brand-red transition-colors"
                  >
                    Active Markets
                  </Link>
                  <Link
                    href="/markets/inactive"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-red-50 hover:text-brand-red transition-colors"
                  >
                    Resolved Markets
                  </Link>
                </div>
              )}
            </div>

            <Link
              href="/leaderboard"
              className="text-gray-700 hover:text-brand-red px-3 py-2 rounded-md text-sm font-medium transition-colors"
            >
              Leaderboard
            </Link>

            {user ? (
              <>
                <Link
                  href="/notifications"
                  className="relative text-gray-700 hover:text-brand-red px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Notifications
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-brand-pink text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </Link>

                <Link
                  href="/profile"
                  className="text-gray-700 hover:text-brand-red px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Profile
                </Link>

                {ADMIN_EMAILS.includes(user.email) && (
                  <Link
                    href="/admin"
                    className="text-gray-700 hover:text-brand-red px-3 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Admin
                  </Link>
                )}

                <button
                  onClick={handleLogout}
                  className="text-gray-700 hover:text-brand-red px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="bg-brand-red text-white px-6 py-2 rounded-lg text-sm font-semibold hover:bg-brand-darkred transition-colors shadow-md"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}