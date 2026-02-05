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
        // Fetch unread notification count
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
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="text-xl font-bold text-indigo-600">
              Prediction Markets
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {user ? (
              <>
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
                  href="/profile"
                  className="text-gray-700 hover:text-indigo-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Profile
                </Link>

                {ADMIN_EMAILS.includes(user.email) && (
                  <Link
                    href="/admin"
                    className="text-gray-700 hover:text-indigo-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                  >
                    Admin
                  </Link>
                )}

                <button
                  onClick={handleLogout}
                  className="text-gray-700 hover:text-red-600 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
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