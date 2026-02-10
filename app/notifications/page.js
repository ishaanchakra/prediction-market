'use client';
import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { collection, query, where, orderBy, getDocs, doc, updateDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      await fetchNotifications(currentUser.uid);
    });

    return () => unsubscribe();
  }, [router]);

  async function fetchNotifications(userId) {
    try {
      const q = query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const notifData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setNotifications(notifData);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  }

  async function markAsRead(notificationId) {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        read: true
      });
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  }

  async function markAllAsRead() {
    try {
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
      await Promise.all(
        unreadIds.map(id => updateDoc(doc(db, 'notifications', id), { read: true }))
      );
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }

  if (loading) return <div className="p-8 bg-brand-red text-white min-h-screen">Loading...</div>;

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="p-8 max-w-4xl mx-auto bg-brand-red min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-white opacity-80 mt-1">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="text-sm text-white hover:text-brand-lightpink"
          >
            Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg">
          <p className="text-gray-500">No notifications yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notif) => (
            <Link
              key={notif.id}
              href={`/market/${notif.marketId}`}
              onClick={() => !notif.read && markAsRead(notif.id)}
              className={`block p-4 rounded-lg transition-all border-2 ${
                notif.read 
                  ? 'bg-white border-gray-200 hover:border-gray-300' 
                  : 'bg-white border-brand-pink hover:border-brand-red shadow-md'
              }`}
            >
              {/* Payout notification */}
              {notif.type === 'payout' && (
                <>
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">💰</span>
                    {!notif.read && (
                      <span className="bg-brand-red text-white text-xs font-bold px-2 py-1 rounded-full">
                        NEW
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-gray-900 mb-1">Market Resolved!</p>
                  <p className="text-sm text-gray-700 mb-2">{notif.marketQuestion}</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`px-2 py-1 rounded font-semibold ${
                      notif.resolution === 'YES' 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {notif.resolution}
                    </span>
                    <span className="text-green-600 font-bold">
                      +${notif.amount.toFixed(2)} earned
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {notif.createdAt?.toDate?.()?.toLocaleDateString() || 'Recently'}
                  </p>
                </>
              )}

              {/* Loss notification */}
              {notif.type === 'loss' && (
                <>
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">📉</span>
                    {!notif.read && (
                      <span className="bg-brand-red text-white text-xs font-bold px-2 py-1 rounded-full">
                        NEW
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-gray-900 mb-1">Market Resolved</p>
                  <p className="text-sm text-gray-700 mb-2">{notif.marketQuestion}</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`px-2 py-1 rounded font-semibold ${
                      notif.resolution === 'YES'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {notif.resolution}
                    </span>
                    <span className="text-red-600 font-bold">
                      -${notif.amount.toFixed(2)} lost
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {notif.createdAt?.toDate?.()?.toLocaleDateString() || 'Recently'}
                  </p>
                </>
              )}

              {/* Significant trade notification */}
              {notif.type === 'significant_trade' && (
                <>
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">🐋</span>
                    {!notif.read && (
                      <span className="bg-brand-red text-white text-xs font-bold px-2 py-1 rounded-full">
                        NEW
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-gray-900 mb-1">Large Trade Alert!</p>
                  <p className="text-sm text-gray-700 mb-2">{notif.marketQuestion}</p>
                  <div className="text-sm text-gray-700 space-y-1">
                    <p>
                      <span className="font-semibold">{notif.traderNetid}</span> placed a{' '}
                      <span className={`font-bold ${
                        notif.tradeSide === 'YES' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        ${notif.tradeAmount} {notif.tradeSide}
                      </span> bet
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="text-gray-600">
                        {notif.oldProbability}% → {notif.newProbability}%
                      </span>
                      <span className={`font-semibold ${
                        notif.probabilityChange.startsWith('+') ? 'text-green-600' : 'text-red-600'
                      }`}>
                        ({notif.probabilityChange})
                      </span>
                    </p>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">
                    {notif.createdAt?.toDate?.()?.toLocaleString() || 'Just now'}
                  </p>
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}