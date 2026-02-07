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
<<<<<<< HEAD
  const [showMarketsDropdown, setShowMarketsDropdown] = useState(false);
=======
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7
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
    <nav className="bg-carnelian border-b-4 border-carnelian-dark shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="text-2xl font-bold text-cream tracking-tight">
              🌽 Cornell Prediction Markets
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <>
                {/* Markets Dropdown */}
                <div 
                  className="relative"
                  onMouseEnter={() => setShowMarketsDropdown(true)}
                  onMouseLeave={() => setShowMarketsDropdown(false)}
                >
                  <button className="text-gray-700 hover:text-indigo-600 px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1">
                    Markets
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {showMarketsDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-200 rounded-md shadow-lg py-1 z-50">
                      <Link
                        href="/markets/active"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                      >
                        Active Markets
                      </Link>
                      <Link
                        href="/markets/resolved"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                      >
                        Resolved Markets
                      </Link>
                    </div>
                  )}
                </div>

                <Link
                  href="/leaderboard"
                  className="text-gray-700 hover:text-indigo-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Leaderboard
                </Link>

                <Link
                  href="/notifications"
                  className="relative text-gray-700 hover:text-indigo-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Notifications
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </Link>

                <Link
                  href="/leaderboard"
                  className="text-cream hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Leaderboard
                </Link>

                <Link
                  href="/notifications"
                  className="relative text-cream hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Notifications
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-yellow-400 text-carnelian-dark text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </Link>

                <Link
                  href="/profile"
                  className="text-cream hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Profile
                </Link>

                {ADMIN_EMAILS.includes(user.email) && (
                  <Link
                    href="/admin"
<<<<<<< HEAD
                    className="text-gray-700 hover:text-indigo-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
=======
                    className="text-cream hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors"
>>>>>>> df276324ebf5caac22ac815a1daa21df544addb7
                  >
                    Admin
                  </Link>
                )}

                <button
                  onClick={handleLogout}
                  className="text-cream hover:text-yellow-300 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="bg-cream text-carnelian px-4 py-2 rounded-md text-sm font-semibold hover:bg-white transition-colors"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}