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
    <nav className="bg-white border-b-2 border-gray-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex justify-between items-center h-20">
          <Link href="/" className="flex items-center gap-3 group">
            <span className="text-4xl">🌽</span>
            <span className="text-2xl font-bold text-carnelian tracking-tight">
              Cornell Markets
            </span>
          </Link>

          <div className="flex items-center gap-2">
            {user ? (
              <>
                <Link
                  href="/leaderboard"
                  className="px-4 py-2 text-gray-700 hover:text-carnelian font-semibold transition-colors rounded-lg hover:bg-cream"
                >
                  Leaderboard
                </Link>

                <Link
                  href="/notifications"
                  className="relative px-4 py-2 text-gray-700 hover:text-carnelian font-semibold transition-colors rounded-lg hover:bg-cream"
                >
                  Notifications
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 bg-carnelian text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </Link>

                <Link
                  href="/profile"
                  className="px-4 py-2 text-gray-700 hover:text-carnelian font-semibold transition-colors rounded-lg hover:bg-cream"
                >
                  Profile
                </Link>

                {ADMIN_EMAILS.includes(user.email) && (
                  <Link
                    href="/admin"
                    className="px-4 py-2 text-gray-700 hover:text-carnelian font-semibold transition-colors rounded-lg hover:bg-cream"
                  >
                    Admin
                  </Link>
                )}

                <button
                  onClick={handleLogout}
                  className="ml-2 px-5 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="px-6 py-3 bg-carnelian text-white font-bold rounded-xl hover:bg-carnelian-dark transition-all shadow-lg hover:shadow-xl"
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